/**
 * 등록·수정 폼의 섹션 카드.
 *
 * **입력칸이 한 줄로 쭉 이어지면 어디까지가 한 묶음인지 보이지 않습니다.** 긴 폼일수록
 * 「지금 무엇을 쓰고 있는지」를 잃기 쉬워서, 묶음마다 제목과 설명을 붙여 갈라놓습니다.
 *
 * 테두리에 **아주 옅은 그림자**를 더했습니다. 「1px 테두리 + 넓은 그림자 동시 사용
 * 금지」 규칙이 막는 것은 존재감이 큰 그림자이고, 여기 쓰는 값(3% 불투명도)은 카드를
 * 살짝 띄우는 정도입니다. 이 화면은 바탕을 옅게 깔아 흰 카드가 떠 보이게 했습니다.
 *
 * 아이콘은 `lucide-react` 한 세트로 통일합니다. 이모지를 쓰지 않습니다.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  /** 이 묶음이 무엇인지 한 줄 설명. 없으면 그리지 않습니다 */
  desc?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

export default function FormCard({ title, desc, icon: Icon, children, className }: Props) {
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-6 shadow-[0_4px_12px_rgba(0,0,0,0.03)] sm:px-8 sm:py-7",
        className
      )}
    >
      <h2 className="flex items-center gap-2 text-[18px] font-extrabold">
        {Icon && <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />}
        {title}
      </h2>
      {desc && <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{desc}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
