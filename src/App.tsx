import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import ProgramDetailPage from "./pages/ProgramDetailPage";
import ProgramRegisterPage from "./pages/ProgramRegisterPage";
import AuthNaverCallbackPage from "./pages/AuthNaverCallbackPage";
import MyProgramsPage from "./pages/MyProgramsPage";
import { AuthProvider } from "./hooks/useAuth";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/programs/new" element={<ProgramRegisterPage />} />
            <Route path="/my/programs" element={<MyProgramsPage />} />
            <Route path="/programs/:id" element={<ProgramDetailPage />} />
            {/* 네이버 개발자센터에 등록된 콜백 주소입니다(15-7). 경로를 바꾸면
                콘솔 등록값도 함께 바꿔야 로그인이 동작합니다. */}
            <Route path="/auth/naver/callback" element={<AuthNaverCallbackPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
