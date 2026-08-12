import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * 로그인 프로토타입 (UI만).
 *
 * TODO(연동): 카카오·네이버 개발자센터 앱 등록 후 아래를 실제 플로우로 교체합니다.
 *   1) 카카오: Kakao JS SDK `Kakao.Auth.authorize()` → 리다이렉트 → 인가코드
 *   2) 네이버: 네이버 아이디로 로그인(naveridlogin-sdk) → 콜백 → access token
 *   3) 두 경우 모두 토큰을 Cloud Functions로 보내 검증 후 Firebase Custom Token 발급
 *      → 프론트에서 `signInWithCustomToken()` → users 문서의 authProvider = kakao|naver
 *   4) 문자인증: Firebase Auth Phone(reCAPTCHA) 또는 국내 문자 대행사 → authProvider = phone
 * 스키마 2-1 users 참고. 지금은 버튼만 있고 어떤 요청도 보내지 않습니다.
 */
export default function LoginDialog() {
  const [phone, setPhone] = useState("");

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
          <DialogDescription>
            소셜 계정 또는 휴대폰 번호로 시작할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 space-y-2">
          <button
            type="button"
            disabled
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[15px] font-semibold text-[#191600] disabled:opacity-60"
          >
            <span aria-hidden>💬</span> 카카오로 3초 만에 시작
          </button>
          <button
            type="button"
            disabled
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#03C75A] text-[15px] font-semibold text-white disabled:opacity-60"
          >
            <span aria-hidden className="font-black">N</span> 네이버로 시작
          </button>
        </div>

        <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          또는
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-phone" className="text-[13px]">
            휴대폰 번호
          </Label>
          <div className="flex gap-2">
            <Input
              id="login-phone"
              inputMode="numeric"
              placeholder="01012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <Button variant="secondary" disabled className="whitespace-nowrap">
              인증번호 받기
            </Button>
          </div>
        </div>

        <p className="mt-2 rounded-lg bg-secondary px-3 py-2.5 text-[12.5px] leading-relaxed text-secondary-foreground">
          프로토타입 화면입니다. 카카오·네이버 개발자센터 앱 등록과 인증 API 연동은
          아직 진행되지 않아 실제 로그인은 동작하지 않습니다.
        </p>

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          가입 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
          {" "}
          {/* TODO: termsAgreements 컬렉션(스키마 2-12)에 항목별 동의 기록 */}
        </p>
      </DialogContent>
    </Dialog>
  );
}
