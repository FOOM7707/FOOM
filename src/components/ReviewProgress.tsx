/**
 * 전문가 자격 심사 진행 단계 (스키마 15-1 · v23).
 *
 * 「지금 내가 어디쯤인지」를 보여주는 것이 목적입니다. 상태 문구만 있으면
 * 「대기 중」이 방치된 것인지 진행 중인 것인지 알 수 없습니다.
 *
 * **4칸이 전부 실제 데이터로 움직입니다.** 「심사 중」은 관리자가 심사를 시작할 때
 * 서버에 기록되는 값입니다 — 데이터 없이 칸만 그리면 그 칸이 영원히 안 켜지고,
 * 사용자는 멈춘 것으로 읽습니다(15-9의 「누를 데 없는 CTA를 두지 않는다」와 같은 판단).
 *
 * **온라인 신청은 아직 없습니다.** 그래서 1번 칸은 「문의로 접수된 뒤」에 켜집니다.
 * 신청 폼이 생기면 그 시점이 1번 칸의 기준이 됩니다.
 */

type ApprovalStatus = "pending" | "reviewing" | "approved" | "rejected" | null;

interface Props {
  /** 공급자 계정인지. 아니면 아직 접수 전입니다 */
  isProvider: boolean;
  approvalStatus: ApprovalStatus;
  /** 반려 사유 — 반려일 때만 씁니다 */
  note?: string | null;
}

const STEPS = [
  { key: "received", label: "접수", hint: "자격 확인 요청이 등록됐습니다" },
  { key: "waiting", label: "심사 대기", hint: "담당자 확인을 기다립니다" },
  { key: "reviewing", label: "심사 중", hint: "담당자가 서류를 확인하고 있습니다" },
  { key: "result", label: "승인", hint: "전문가로 활동할 수 있습니다" },
] as const;

/** 현재 몇 번째 칸까지 왔는지 (0 = 아직 접수 전) */
function currentStep(isProvider: boolean, status: ApprovalStatus): number {
  if (!isProvider) return 0;
  switch (status) {
    case "pending":
      return 2;
    case "reviewing":
      return 3;
    case "approved":
    case "rejected":
      return 4;
    default:
      // 프로필은 있는데 상태가 비어 있는 경우 — 접수까지는 된 것으로 봅니다.
      return 1;
  }
}

export default function ReviewProgress({ isProvider, approvalStatus, note }: Props) {
  const step = currentStep(isProvider, approvalStatus);
  const rejected = approvalStatus === "rejected";

  return (
    <div>
      <ol className="flex items-start gap-0">
        {STEPS.map((s, i) => {
          const index = i + 1;
          const done = step >= index;
          const active = step === index;
          const isResult = s.key === "result";
          const failed = isResult && rejected;

          const label = failed ? "반려" : s.label;
          const hint = failed ? "사유를 확인해 다시 요청해 주세요" : s.hint;

          // 색은 브랜드 그린을 씁니다. 반려만 경고색입니다.
          const dotClass = failed
            ? "bg-destructive text-white"
            : done
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground";

          const lineClass = step > index ? "bg-primary" : "bg-border";

          return (
            <li key={s.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* 첫 칸 왼쪽·마지막 칸 오른쪽 선은 그리지 않습니다 */}
                <span
                  className={`h-[2px] flex-1 ${i === 0 ? "bg-transparent" : step >= index ? "bg-primary" : "bg-border"}`}
                />
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold ${dotClass}`}
                >
                  {failed ? "!" : done ? "✓" : index}
                </span>
                <span
                  className={`h-[2px] flex-1 ${i === STEPS.length - 1 ? "bg-transparent" : lineClass}`}
                />
              </div>
              <p
                className={`mt-2 text-center text-[13px] font-semibold ${
                  failed
                    ? "text-destructive"
                    : active
                      ? "text-primary"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground"
                }`}
              >
                {label}
              </p>
              <p className="mt-0.5 max-w-[9rem] text-center text-[11.5px] leading-snug text-muted-foreground">
                {active || failed ? hint : ""}
              </p>
            </li>
          );
        })}
      </ol>

      {rejected && note && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3.5 py-3 text-[13px] leading-relaxed text-destructive">
          <strong className="font-semibold">반려 사유</strong>
          <br />
          {note}
        </p>
      )}
    </div>
  );
}
