import { useState, type FormEvent, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 비공개 테스트 배포용 관문.
 *
 * **보안 장치가 아닙니다.** 비밀번호가 화면 코드(번들) 안에 들어가므로 뜯어보면
 * 통과할 수 있습니다 — 관리자 메뉴 숨김·라우트 가드가 보안이 아닌 것과 같습니다(12-3).
 * 목적은 「주소를 우연히 알게 된 사람이 그냥 들어오는 것」을 막는 것이고,
 * 실제 데이터는 보안규칙과 함수 진입부가 지킵니다.
 *
 * 그래서 여기 쓰는 비밀번호는 **다른 곳에서 쓰는 것과 절대 같게 두지 마세요.**
 *
 * `VITE_SITE_PASSWORD`가 비어 있으면 관문 자체가 없습니다 — 로컬 개발(`npm run dev`)은
 * 값을 넣지 않는 한 아무 영향도 받지 않고, **정식 오픈 때는 배포 환경의 값만 지우면**
 * 코드를 되돌리지 않아도 관문이 사라집니다.
 */
const PASSWORD: string = import.meta.env.VITE_SITE_PASSWORD ?? "";

/**
 * 통과 여부가 아니라 **통과할 때 쓴 비밀번호**를 저장합니다. 비밀번호를 바꾸면
 * 저장된 값과 어긋나 모두가 다시 입력하게 됩니다 — 사람을 빼야 할 때 쓰는 유일한 수단입니다.
 */
const STORAGE_KEY = "foom.site-gate";

/** 시크릿 모드·저장소 차단 환경에서 접근 자체가 예외를 던집니다. 관문이 화면을 깨면 안 됩니다. */
function readSaved(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function save(value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 저장에 실패해도 이번 방문은 그대로 통과시킵니다(새로고침하면 다시 물어봅니다).
  }
}

export default function SiteGate({ children }: { children: ReactNode }) {
  // 훅은 조기 return보다 위에 모두 옵니다 — 순서가 갈리면 화면이 통째로 비고,
  // 타입 검사·빌드로는 잡히지 않습니다(lint의 rules-of-hooks만 잡습니다).
  const [unlocked, setUnlocked] = useState(() => !PASSWORD || readSaved() === PASSWORD);
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(false);

  if (unlocked) return <>{children}</>;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value !== PASSWORD) {
      setFailed(true);
      return;
    }
    save(value);
    setUnlocked(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">비공개 테스트 중입니다</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          품(FOOM)은 아직 준비 중이라 관계자만 볼 수 있습니다. 전달받은 비밀번호를 입력해 주세요.
        </p>

        <form onSubmit={submit} className="mt-6">
          <label htmlFor="site-gate-password" className="text-sm font-medium">
            비밀번호
          </label>
          <Input
            id="site-gate-password"
            type="password"
            className="mt-2"
            value={value}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => {
              setValue(e.target.value);
              setFailed(false);
            }}
          />
          {failed && (
            <p className="mt-2 text-sm text-destructive">비밀번호가 맞지 않습니다.</p>
          )}
          <Button type="submit" size="lg" className="mt-4 w-full" disabled={!value}>
            들어가기
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          비밀번호를 모르시면 운영자에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
