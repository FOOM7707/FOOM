import { useState, type FormEvent } from "react";
import { CATEGORIES } from "../types/firestore";
import type { ScheduleType } from "../types/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

const SCHEDULE_OPTIONS: { value: ScheduleType; label: string; hint: string }[] = [
  { value: "single", label: "1회성", hint: "특정 날짜 1회만 진행" },
  { value: "weekly", label: "매주 반복", hint: "요일·시간을 정해 매주 반복 개설" },
  { value: "series", label: "회차제", hint: "여러 회차로 나눠 순차 진행" },
  { value: "open", label: "상시모집(협의형)", hint: "정원 없이 결제 후 채팅으로 일정 협의" },
];

export default function ProgramRegisterPage() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // TODO(백엔드 연동): 실제로는 POST /programs 호출 → status='draft'로 생성.
    // 지금은 mock 단계라 콘솔에만 기록하고 화면에 확인 메시지를 보여줍니다.
    const formData = new FormData(e.currentTarget);
    console.log("[mock] 프로그램 등록 요청:", Object.fromEntries(formData.entries()));
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <h1 className="mb-3 text-lg font-bold text-secondary-foreground">
              등록 요청이 접수되었습니다 (mock)
            </h1>
            <p className="mb-4 text-sm leading-relaxed">
              실제 백엔드 연동 전까지는 이 화면에서 입력한 값이 저장되지 않습니다. Cloud Functions{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">POST /programs</code> API가
              준비되면 <code className="rounded bg-white px-1.5 py-0.5 text-xs">status='draft'</code>
              로 생성되고,{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">
                POST /programs/&#123;id&#125;/submit-for-review
              </code>
              를 통해 심사 요청까지 이어집니다.
            </p>
            <Button variant="outline" onClick={() => setSubmitted(false)}>
              다시 작성하기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-xl px-5 py-8 pb-20">
      <h1 className="mb-2.5 text-[22px] font-bold">프로그램 등록</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        운영 시작 시 자격증 인증(공급자 승인)이 선행되어야 합니다 — 이 화면은 프로그램 등록 단계만
        다루며, 공급자 가입/자격증 인증 화면은 별도로 준비합니다.
      </p>

      <form className="flex flex-col gap-[18px]" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">프로그램명</Label>
          <Input id="title" name="title" required placeholder="예: 주말 산림치유 명상 프로그램" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">소개</Label>
          <Textarea
            id="description"
            name="description"
            required
            rows={4}
            placeholder="프로그램 소개를 입력하세요"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category">카테고리</Label>
          <Select id="category" name="category" required defaultValue="">
            <option value="" disabled>
              선택하세요
            </option>
            {CATEGORIES.filter((c) => c !== "전체").map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">장소(주소)</Label>
          <Input id="address" name="address" required placeholder="예: 강원도 홍천군 서면" />
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="price">가격(원)</Label>
            <Input id="price" name="price" type="number" min={0} required placeholder="35000" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="minCapacity">최소 인원</Label>
            <Input id="minCapacity" name="minCapacity" type="number" min={1} required placeholder="4" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="capacity">최대 인원</Label>
            <Input id="capacity" name="capacity" type="number" min={1} required placeholder="12" />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2.5 rounded-lg border px-4 py-3.5">
          <legend className="px-1 text-[13px] text-muted-foreground">운영 방식</legend>
          {SCHEDULE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2.5 text-sm">
              <input type="radio" name="scheduleType" value={opt.value} required className="mt-1" />
              <span>
                <strong className="font-semibold">{opt.label}</strong>
                <span className="block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="barrierFree" />
          무장애(barrier-free) 프로그램입니다
        </label>

        <Button type="submit" size="lg">
          등록 요청 보내기
        </Button>
      </form>
    </div>
  );
}
