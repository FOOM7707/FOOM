import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { startKakaoLogin } from "@/lib/kakaoAuth";
import { startNaverLogin } from "@/lib/naverAuth";

/**
 * 로그인 (스키마 15-1, 15-5).
 *
 * **가입은 소셜 2종뿐입니다.** 휴대폰 번호 입력·인증번호 UI는 15-5에 따라
 * 제거했습니다 — 소비자에게 본인확인을 요구하지 않기로 했고(15-1),
 * 이메일·비밀번호 가입도 만들지 않습니다.
 *
 * **카카오는 비즈 앱 없이도 로그인이 됩니다** (v19). 비즈 앱이 필요한 것은
 * 이메일·전화번호와 간편가입(카카오싱크)이고, 로그인 자체와 닉네임·프로필사진은
 * 심사 없이 열립니다. 두 값이 비어도 가입이 되도록 설계돼 있습니다(2-1, 15-4).
 */
export default function LoginDialog() {
  const { user, loading, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <Button variant="outline" size="sm" disabled>
        로그인
      </Button>
    );
  }

  if (user) {
    return (
      <Button variant="outline" size="sm" onClick={() => void logout()}>
        로그아웃
      </Button>
    );
  }

  /** 로그인 후 보고 있던 화면으로 돌아옵니다. */
  function returnTo(): string {
    return window.location.pathname + window.location.search;
  }

  function handleNaver() {
    try {
      setError(null);
      startNaverLogin(returnTo());
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인을 시작하지 못했습니다.");
    }
  }

  function handleKakao() {
    try {
      setError(null);
      startKakaoLogin(returnTo());
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인을 시작하지 못했습니다.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          로그인
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>품(FOOM) 로그인</DialogTitle>
          <DialogDescription>소셜 계정으로 시작할 수 있습니다.</DialogDescription>
        </DialogHeader>

        <div className="mt-1 space-y-2">
          <button
            type="button"
            onClick={handleKakao}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[15px] font-semibold text-[#191600] transition-opacity hover:opacity-90"
          >
            <span aria-hidden>💬</span> 카카오로 3초 만에 시작
          </button>
          <button
            type="button"
            onClick={handleNaver}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#03C75A] text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            <span aria-hidden className="font-black">
              N
            </span>{" "}
            네이버로 시작
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          가입 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
          {" "}
          {/* TODO(P1): 항목별 동의 체크박스 UI. 지금은 서버가 service·privacy를
              동의한 것으로 termsAgreements에 기록합니다(2-12). 마케팅 수신 동의는
              선택 항목이라 별도 체크박스가 필요합니다. */}
        </p>
      </DialogContent>
    </Dialog>
  );
}
