/**
 * 마이페이지 — 내 정보 (스키마 2-1).
 *
 * **수정은 서버를 거칩니다**(`PATCH /users/me`). 보안규칙은 본인의 `users` 문서
 * 수정을 허용하지만, 연락처는 `+8210…` 한 형식으로만 저장해야 하고 그 정규화
 * 관문이 서버에만 있습니다 — 형식이 섞이면 같은 번호가 다른 문자열로 남아
 * 중복 감지가 통째로 무력해집니다(15-4).
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
      const phoneChanged = phoneDraft.trim() !== displayPhone(me.phone);
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
