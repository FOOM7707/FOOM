import { useParams, Link } from "react-router-dom";
import { mockPrograms, mockSchedules } from "../mocks/programs";
import { mockProviders } from "../mocks/providers";
import ProgramMap from "../components/ProgramMap";
import WeatherWidget from "../components/WeatherWidget";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { regionOfAddress } from "@/lib/geo";

export default function ProgramDetailPage() {
  const { id } = useParams();
  const program = mockPrograms.find((p) => p.id === id);

  if (!program) {
    return (
      <div className="container mx-auto max-w-5xl px-5 py-8">
        <p>프로그램을 찾을 수 없습니다.</p>
        <Link to="/search" className="text-muted-foreground">
          ← 목록으로
        </Link>
      </div>
    );
  }

  const provider = mockProviders.find((p) => p.uid === program.providerId);
  const schedules = mockSchedules.filter((s) => s.programId === program.id);
  const regionLabel = regionOfAddress(program.location.address);

  return (
    <div className="container mx-auto max-w-2xl px-5 py-6 pb-20">
      <Link to="/search" className="mb-4 inline-block text-sm text-muted-foreground">
        ← 목록으로
      </Link>

      <div className="mb-5 flex h-[220px] items-center justify-center rounded-xl bg-secondary font-bold text-secondary-foreground">
        {program.category}
      </div>

      <h1 className="mb-1.5 text-2xl font-bold">{program.title}</h1>
      <p className="mb-4 text-muted-foreground">{program.location.address}</p>
      <p className="mb-6 leading-relaxed">{program.description}</p>

      <div className="mb-7 flex flex-wrap gap-7 rounded-xl border px-5 py-4.5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">가격</span>
          <span className="font-bold">{program.price.toLocaleString()}원</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">정원</span>
          <span className="font-bold">
            최소 {program.minCapacity}명 · 최대 {program.capacity}명
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">무장애(barrier-free)</span>
          <span className="font-bold">{program.barrierFree ? "가능" : "미지원"}</span>
        </div>
      </div>

      {/* 📍 위치 — 와이어프레임 v2 상세 "핀 위치" */}
      <div className="border-t py-5">
        <h2 className="mb-3 text-base font-semibold">위치</h2>
        <ProgramMap programs={[program]} center={program.location} className="h-[240px]" />
        <p className="mt-2 text-[12px] text-muted-foreground">
          정확한 집결 장소는 예약 확정 후 안내됩니다. (프로토타입 지도 — 최종 서비스는
          카카오맵)
        </p>
      </div>

      {/* 🌤 날씨 예보 — 와이어프레임 v2 상세 "진행일 기준 강수확률·특보 배지" */}
      <div className="border-t py-5">
        <h2 className="mb-3 text-base font-semibold">날씨 예보</h2>
        <WeatherWidget
          point={program.location}
          regionLabel={`${regionLabel} · ${
            schedules[0]
              ? new Date(schedules[0].startAt).toLocaleDateString("ko-KR", {
                  month: "long",
                  day: "numeric",
                })
              : "오늘"
          } 기준`}
          date={schedules[0] ? new Date(schedules[0].startAt) : undefined}
        />
      </div>

      {program.scheduleType === "open" ? (
        <div className="border-t py-5">
          <h2 className="mb-3 text-base font-semibold">상시모집 (협의형)</h2>
          <p className="text-sm">
            결제 후 채팅으로 실제 진행 일정을 협의합니다. 이용 가능 기간:{" "}
            {program.availableFrom?.slice(0, 10)} ~ {program.availableUntil?.slice(0, 10)}
          </p>
        </div>
      ) : (
        <div className="border-t py-5">
          <h2 className="mb-3 text-base font-semibold">예약 가능한 회차</h2>
          {schedules.length === 0 && (
            <p className="py-4 text-muted-foreground">현재 예약 가능한 회차가 없습니다.</p>
          )}
          {schedules.map((s) => (
            <div key={s.id} className="mb-2 rounded-lg border px-3.5 py-2.5 text-sm">
              <div className="flex justify-between">
                <span>
                  {new Date(s.startAt).toLocaleString("ko-KR", {
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {s.seriesTotal ? ` (${s.seriesIndex}/${s.seriesTotal}회차)` : ""}
                </span>
                <span className="font-semibold text-secondary-foreground">
                  잔여 {s.remainingSlots}자리
                </span>
              </div>
              {/* 회차별 날씨 — 참고용 */}
              <WeatherWidget
                variant="inline"
                className="mt-1.5"
                point={program.location}
                regionLabel={regionLabel}
                date={new Date(s.startAt)}
              />
            </div>
          ))}
        </div>
      )}

      {provider && (
        <div className="border-t py-5">
          <h2 className="mb-3 text-base font-semibold">운영자 정보</h2>
          <p className="mb-1 font-bold">{provider.name}</p>
          <p className="mb-2 text-muted-foreground">{provider.bio}</p>
          <p className="text-amber-600">
            ★ {provider.ratingAvg.toFixed(1)} ({provider.ratingCount}개 리뷰)
          </p>
        </div>
      )}

      <Button
        className="mt-5 w-full"
        size="lg"
        variant="secondary"
        disabled
        title="예약/결제는 다음 스프린트에서 연동됩니다"
      >
        예약하기 (준비중)
      </Button>

      {/* 💬 1:1 문의 — 와이어프레임 v2 상세 "문의하기" (MVP 필수 기능) */}
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" className="mt-3 w-full">
            💬 1:1 문의하기
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>1:1 문의</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            프로토타입 화면입니다. 문의 전송은 로그인·문의 API(POST /inquiries) 연동 후
            동작합니다.
          </p>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" className="mt-3 w-full">
            환불정책 보기
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>환불정책</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            7일 전: 전액환불 · 1~6일 전: 50% · 당일: 환불 없음
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            기준일은 진행일입니다. 천재지변·본인 질병·직계가족 상 등 면제 사유에 해당하면
            구간과 무관하게 전액 환불됩니다.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
