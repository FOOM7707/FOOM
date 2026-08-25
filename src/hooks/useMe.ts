/**
 * 내 계정 정보 (`GET /users/me`).
 *
 * 로그인 상태(`useAuth`)와 분리한 이유: `useAuth`는 비로그인 방문자가 대부분인
 * 홈·검색에서도 항상 살아 있어서, 거기에 서버 호출을 붙이면 아무도 안 보는
 * 값을 매번 불러오게 됩니다. 이 훅은 필요한 화면에서만 부릅니다.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { ApiError, apiFetch } from "@/lib/api";

export interface MeProviderInfo {
  displayName: string | null;
  verified: boolean;
  /** (v23) `reviewing` — 관리자가 심사를 시작한 상태. 진행 단계 표시에 씁니다 */
  approvalStatus: "pending" | "reviewing" | "approved" | "rejected" | null;
  approvalNote: string | null;
}

export interface Me {
  uid: string;
  role: "consumer" | "provider" | "admin";
  name: string | null;
  email: string | null;
  phone: string | null;
  /** 소셜 프로필 사진. 「추가」 동의 항목이라 없을 수 있습니다(2-1) */
  profileImageUrl: string | null;
  /** `kakao` / `naver` — 가입 경로는 소셜 2종뿐입니다(2-1) */
  authProvider: string | null;
  status: string;
  provider: MeProviderInfo | null;
}

export function useMe() {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: Me }>("/users/me", { requireAuth: true });
      setMe(res.user);
    } catch (err) {
      setMe(null);
      setError(err instanceof ApiError ? err.message : "계정 정보를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMe(null);
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, user, load]);

  return { me, loading: authLoading || loading, error, reload: load };
}
