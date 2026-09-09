/**
 * 마이페이지 — 내 정보 (스키마 2-1).
 *
 * **수정은 서버를 거칩니다**(`PATCH /users/me`). 연락처는 `+8210…` 한 형식으로만
 * 저장해야 하고 그 정규화 관문이 서버에만 있습니다 — 형식이 섞이면 같은 번호가
 * 다른 문자열로 남아 중복 감지가 통째로 무력해집니다(15-4). 보안규칙도 2026-09-09부터
 * `phone`의 직접 수정을 막습니다.
 *
 * **연락처는 출처에 따라 다르게 보입니다**(2-14, 2026-09-09).
 *  - 네이버·카카오가 준 번호 → **읽기만.** 그 서비스가 본인 확인을 거친 값이라
 *    여기서 바꾸게 두면 인증된 번호가 인증 안 된 값으로 바뀝니다. 바꾸는 길은
 *    그 서비스에서 바꾸고 다시 로그인하는 것이고, 그 안내를 칸 아래에 적습니다.
 *  - 직접 입력한 번호(카카오는 아직 번호를 안 넘겨줍니다) → 고칠 수 있음.
 *    서버는 이 번호로 남의 번호인지 조회하지 않으므로 「이미 쓰는 번호」 같은
 *    응답은 없습니다 — 화면도 그런 분기를 두지 않습니다.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import type { Me } from "@/hooks/useMe";

const PROVIDER_LABEL: Record<string, string> = {
  kakao: "카카오",
  naver: "네이버",
};

const ROLE_LABEL: Record<string, string> = {
  consumer: "일반 회원",
  provider: "산림복지전문가",
  admin: "관리자",
};

/** `+821012345678` → `010-1234-5678`. 저장은 E.164, 표시는 읽기 쉬운 형태입니다 */
export function displayPhone(e164: string | null): string {
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

interface Props {
  me: Me;
  /** 저장 후 값을 다시 읽습니다 — 화면이 상태를 따로 조립하면 서버와 어긋납니다 */
  onSaved: () => void;
}

export default function ProfileSection({ me, onSaved }: Props) {
  // 소셜이 준 번호만 잠깁니다. 출처가 없는 옛 문서(2026-09-09 이전)는 직접 입력으로
  // 다루고, 소셜이 번호를 주는 다음 로그인 때 서버가 출처를 채워 넣습니다.
  const socialSource =
    me.phone && (me.phoneSource === "naver" || me.phoneSource === "kakao")
      ? me.phoneSource
      : null;
  const phoneLocked = socialSource !== null;
  const socialLabel = socialSource ? PROVIDER_LABEL[socialSource] : null;

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function startEdit() {
    setNameDraft(me.name ?? "");
    setPhoneDraft(displayPhone(me.phone));
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // 바뀐 것만 보냅니다 — 서버는 「안 보낸 항목」을 건드리지 않습니다.
      // 연락처를 비운 채 보내면 서버가 거부하므로, 비었으면 아예 넣지 않습니다.
      const body: Record<string, string> = {};
      if (nameDraft.trim() !== (me.name ?? "")) body.name = nameDraft;
      // 잠긴 번호는 입력칸 자체가 없지만, 그래도 보내지 않는 것을 여기서 한 번 더 못박습니다.
      const phoneChanged = !phoneLocked && phoneDraft.trim() !== displayPhone(me.phone);
      if (phoneChanged && phoneDraft.trim() !== "") body.phone = phoneDraft;

      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }

      await apiFetch("/users/me", { method: "PATCH", body, requireAuth: true });
      onSaved();
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "저장하지 못했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3.5">
        {me.profileImageUrl ? (
          <img
            src={me.profileImageUrl}
            alt=""
            className="h-14 w-14 rounded-full bg-secondary object-cover"
          />
        ) : (
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-base font-extrabold text-primary-foreground"
            aria-hidden
          >
            {(me.name ?? "품").slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold">{me.name ?? "이용자"}</p>
          <p className="text-[13px] text-muted-foreground">
            {ROLE_LABEL[me.role] ?? me.role}
            {me.authProvider &&
              ` · ${PROVIDER_LABEL[me.authProvider] ?? me.authProvider} 로그인`}
          </p>
        </div>
      </div>

      {editing ? (
        <div className="flex max-w-md flex-col gap-4">
          <div>
            <Label htmlFor="my-name">이름</Label>
            <Input
              id="my-name"
              value={nameDraft}
              maxLength={30}
              onChange={(e) => setNameDraft(e.target.value)}
              className="mt-1.5"
            />
            {/* 남에게 보이는 값이라는 것을 알려줍니다 — 실명을 넣을지 판단하는 데
                필요한 정보입니다(2-1). */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              후기를 쓰면 이 이름이 다른 이용자에게 보입니다. 실명이 아니어도 됩니다.
            </p>
          </div>

          {phoneLocked ? (
            <div>
              <Label>연락처</Label>
              <p className="mt-1.5 text-sm font-semibold">{displayPhone(me.phone)}</p>
              {/* 바꿀 수 없는 이유와 바꾸는 길을 같이 적습니다 — 이유만 적으면
                  「그럼 어떻게 하라는 건가」가 되고, 길만 적으면 왜 막혔는지 모릅니다. */}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {socialLabel} 계정에서 받은 번호라 여기서는 바꿀 수 없습니다. {socialLabel}
                에서 번호를 바꾼 뒤 다시 로그인하면 반영됩니다.
              </p>
            </div>
          ) : (
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
                {me.authProvider === "kakao" &&
                  " 카카오는 아직 번호를 넘겨주지 않아 직접 입력합니다."}
              </p>
            </div>
          )}

          {saveError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
              {saveError}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <>
          <dl className="max-w-md">
            <Row label="이름">{me.name ?? "-"}</Row>
            <Row label="연락처">
              {me.phone ? (
                <>
                  {displayPhone(me.phone)}
                  {/* 출처를 함께 보여줍니다 — 잠긴 번호를 수정 화면에서 처음 알게 되면
                      「왜 못 바꾸지」가 됩니다. 옛 문서(출처 없음)는 표시를 생략합니다. */}
                  {socialLabel && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {socialLabel} 계정 번호
                    </span>
                  )}
                  {me.phoneSource === "manual" && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      직접 입력
                    </span>
                  )}
                </>
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

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={startEdit}>
              내 정보 수정
            </Button>
            {saved && (
              <span className="text-[13px] font-semibold text-primary">저장했습니다</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
