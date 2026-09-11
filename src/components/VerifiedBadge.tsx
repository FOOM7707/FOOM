/**
 * 자격 심사를 통과한 전문가 표시 (2026-09-11).
 *
 * **같은 배지가 세 군데에 복사돼 있던 것을 하나로 모았습니다** — 마이페이지 전문가
 * 활동 · 프로그램 상세의 운영자 · 관리자 심사 목록. 자리마다 따로 두면 색이나 문구를
 * 고칠 때 한 곳을 빠뜨리게 되고, **같은 뜻의 표시가 화면마다 달라 보입니다.**
 *
 * **기준은 공개 프로필의 `verified`입니다**(2-2). 관리자가 자격 심사를 승인할 때만
 * 켜지는 값이라, 이 배지가 붙어 있으면 **사람이 실제로 서류를 확인했다**는 뜻입니다.
 * 자격 신청만 한 상태(`role === 'provider'`)에는 붙지 않습니다 — 그렇게 하면
 * 심사의 의미가 사라지고, 손님에게는 검증된 것으로 보입니다.
 *
 * **표시 자체가 보증은 아니므로 문구를 키우지 않습니다** — 「공식 인증」·「검증 완료」
 * 같은 말은 우리가 보증하는 범위를 넘습니다(전문가 안내 화면에서 같은 판단을 했습니다).
 */

import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * 배지 글자. 기본은 「인증」입니다 — 운영자 이름 옆처럼 **전문가 맥락이 분명한
   * 자리**에서는 한 글자라도 짧은 편이 낫습니다. 내 계정 화면처럼 무엇에 대한
   * 인증인지 알기 어려운 자리에서만 「인증 전문가」로 풀어 씁니다.
   */
  label?: string;
  className?: string;
}

export default function VerifiedBadge({ label = "인증", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[11px] font-bold text-primary",
        className
      )}
    >
      {/* 아이콘은 선 아이콘만 씁니다(이모지 금지) — MD/frontend/frontend.md */}
      <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  );
}
