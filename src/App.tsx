import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import ProgramDetailPage from "./pages/ProgramDetailPage";
import ProgramRegisterPage from "./pages/ProgramRegisterPage";
import ProviderApplyPage from "./pages/ProviderApplyPage";
import AuthNaverCallbackPage from "./pages/AuthNaverCallbackPage";
import AuthKakaoCallbackPage from "./pages/AuthKakaoCallbackPage";
import MyProgramsPage from "./pages/MyProgramsPage";
import MyPage from "./pages/MyPage";
import { AuthProvider } from "./hooks/useAuth";

// 관리자 화면은 지연 로딩해 일반 사용자 번들에서 분리합니다(12-3).
// **보안 목적이 아닙니다** — 화면 코드가 노출돼도 데이터는 새지 않습니다.
// 소비자 화면의 초기 로딩을 가볍게 유지하기 위한 조치입니다.
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/provider/apply" element={<ProviderApplyPage />} />
            <Route path="/programs/new" element={<ProgramRegisterPage />} />
            {/* 등록과 같은 화면을 씁니다 — 받는 값과 검증이 같아서 둘로 나누면
                한쪽만 고치는 일이 생깁니다. :id 가 있으면 수정 모드입니다. */}
            <Route path="/programs/:id/edit" element={<ProgramRegisterPage />} />
            {/* `/my/programs`가 먼저 와야 합니다 — 순서를 바꾸면 `/my`가
                먼저 잡혀 「내 프로그램」이 열리지 않습니다. */}
            <Route path="/my/programs" element={<MyProgramsPage />} />
            <Route path="/my" element={<MyPage />} />
            <Route path="/programs/:id" element={<ProgramDetailPage />} />
            <Route
              path="/admin"
              element={
                <Suspense
                  fallback={<div className="container mx-auto px-5 py-10">불러오는 중…</div>}
                >
                  <AdminPage />
                </Suspense>
              }
            />
            {/* 네이버 개발자센터에 등록된 콜백 주소입니다(15-7). 경로를 바꾸면
                콘솔 등록값도 함께 바꿔야 로그인이 동작합니다. */}
            <Route path="/auth/naver/callback" element={<AuthNaverCallbackPage />} />
            <Route path="/auth/kakao/callback" element={<AuthKakaoCallbackPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
