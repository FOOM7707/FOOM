/**
 * 로그인 상태 관리.
 *
 * 화면에서 쓰는 값은 Firebase Auth의 상태뿐입니다. `users` 문서(role·name 등)는
 * 필요한 화면에서 따로 읽습니다 — 여기서 미리 읽어두면 로그인만 해도 Firestore
 * 읽기가 발생하고, 비로그인 사용자가 대부분인 홈·검색에서 낭비가 됩니다.
 *
 * **`role`을 화면 상태로 신뢰하지 마세요.** 관리자 메뉴 노출 같은 건 UX 처리일
 * 뿐이고 실제 차단은 함수 진입부와 보안규칙에서 이루어집니다(12-3).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";

interface AuthState {
  user: User | null;
  /**
   * 토큰 Custom Claims의 `admin`. 헤더의 관리자 메뉴 노출과 `/admin` 라우트
   * 가드에 씁니다 — **둘 다 UX 처리입니다.** 실제 차단은 함수 진입부와
   * 보안규칙이 같은 클레임을 보고 합니다(12-3). Firestore의 `users.role`이
   * 아니라 클레임을 보는 이유도 그것입니다 — 둘이 어긋나면 클레임이 기준입니다.
   */
  isAdmin: boolean;
  /**
   * 토큰 Custom Claims의 `provider`·`providerApproved` (2026-09-11).
   *
   * **헤더 버튼을 무엇으로 그릴지에만 씁니다.** 전문가 여부를 서버에 물어보면
   * 로그인한 사람이 페이지를 열 때마다 요청이 하나씩 붙고, 답이 올 때까지
   * 「전문가로 활동하기」가 떴다가 「프로그램 등록」으로 바뀌는 깜빡임이 매번
   * 보입니다. 토큰은 이미 손에 있어 둘 다 없습니다.
   *
   * ⚠️ **권한 판단에 쓰지 마세요.** 등록을 막는 것은 서버가 회원 정보를 직접
   * 읽어서 합니다 — 이 값은 최대 1시간 낡을 수 있습니다(클레임은 이미 발급된
   * 토큰에 소급되지 않음). 방금 자격을 받았다면 다시 로그인해야 바로 보입니다.
   */
  isProvider: boolean;
  isProviderApproved: boolean;
  /** 첫 상태 확인이 끝나기 전인지 — 깜빡임 방지용 */
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isProvider, setIsProvider] = useState(false);
  const [isProviderApproved, setIsProviderApproved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (next) => {
      setUser(next);
      setLoading(false);

      if (!next) {
        setIsAdmin(false);
        setIsProvider(false);
        setIsProviderApproved(false);
        return;
      }
      // 캐시된 토큰을 읽을 뿐이라 네트워크 요청이 아닙니다.
      // 권한을 방금 부여받았다면 재로그인이나 토큰 갱신이 필요합니다.
      void next
        .getIdTokenResult()
        .then((res) => {
          setIsAdmin(res.claims.admin === true);
          setIsProvider(res.claims.provider === true);
          setIsProviderApproved(res.claims.providerApproved === true);
        })
        .catch(() => {
          setIsAdmin(false);
          setIsProvider(false);
          setIsProviderApproved(false);
        });
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAdmin,
      isProvider,
      isProviderApproved,
      loading,
      logout: () => signOut(firebaseAuth),
    }),
    [user, isAdmin, isProvider, isProviderApproved, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 쓸 수 있습니다");
  return ctx;
}
