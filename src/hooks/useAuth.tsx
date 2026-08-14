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
  /** 첫 상태 확인이 끝나기 전인지 — 깜빡임 방지용 */
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (next) => {
      setUser(next);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout: () => signOut(firebaseAuth),
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 쓸 수 있습니다");
  return ctx;
}
