import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import ProgramDetailPage from "./pages/ProgramDetailPage";
import ProgramRegisterPage from "./pages/ProgramRegisterPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/programs/new" element={<ProgramRegisterPage />} />
          <Route path="/programs/:id" element={<ProgramDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
