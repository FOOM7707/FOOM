/**
 * 프로그램 상세 (스키마 20번).
 *
 * **실제 서버 데이터를 씁니다(v27).** 이 화면은 오래 `src/mocks/`로 돌아갔는데,
 * `GET /programs/{id}`가 회차·운영자까지 함께 내려주므로 **검색 API 없이도** 실데이터로
 * 바꿀 수 있습니다 — 홈·검색과 달리 상세는 프로그램 하나만 읽으면 됩니다.
 *
 * **폭이 1440px입니다**(다른 화면은 1152px). 큰 사진과 지그재그 소개가 구성의
 * 전제라 좁히면 성립하지 않습니다 — `/provider/apply`와 같은 판단입니다(20-5).
 *
 * **시안에 있었지만 넣지 않은 것들이 있습니다**(20-5) — 할인율·케어 배너·찜·후기 수·
 * 가격 옵션. 지금 없는 기능이라 넣으면 화면이 거짓말을 합니다.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ProgramMap from "../components/ProgramMap";
import WeatherWidget from "../components/WeatherWidget";
import ProgramGallery from "../components/ProgramGallery";
import IntroBlockView from "../components/IntroBlockView";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { regionOfAddress } from "@/lib/geo";
import type { Program } from "@/types/firestore";
import { ApiError, apiFetch } from "@/lib/api";
import {
  EXCLUDE_OPTIONS,
  INCLUDE_OPTIONS,
  PREPARATION_OPTIONS,
  keywordLabel,
  type IntroBlock,
  type KeywordField,
  type KeywordOption,
} from "@/lib/programContent";

interface DetailSchedule {
  id: string;
  startAt: string;
  endAt: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  totalSlots?: number;
  remainingSlots: number;
}

interface DetailProvider {
  uid: string;
  displayName: string | null;
  bio: string | null;
  verified: boolean;
  ratingAvg: number;
  ratingCount: number;
}

interface DetailProgram {
  id: string;
  providerId: string;
  qualificationType: string;
  title: string;
  description: string;
  category: string;
  status: string;
  location: { address: string; lat: number | null; lng: number | null };
  price: number;
  capacity: number;
  minCapacity: number;
  scheduleType: string;
  availableFrom: string | null;
  availableUntil: string | null;
  barrierFree: boolean;
  rainAlternative: string;
  walkingDistanceM: number | null;
  difficulty?: string;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  imageUrls: string[];
  includes?: KeywordField;
  excludes?: KeywordField;
  preparations?: KeywordField;
  introBlocks?: IntroBlock[];
  schedules: DetailSchedule[];
  provider: DetailProvider | null;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
};

const RAIN_LABEL: Record<string, string> = {
  indoor: "실내로 바꿔서 진행",
  reschedule: "다른 날로 옮김",
  none: "우천 시 진행 불가",
};

const STATUS_NOTICE: Record<string, string> = {
  draft: "작성 중인 프로그램입니다. 아직 손님에게는 보이지 않습니다.",
  pending_review: "심사 중인 프로그램입니다. 아직 손님에게는 보이지 않습니다.",
  hidden: "반려·숨김 상태입니다. 아직 손님에게는 보이지 않습니다.",
};

/** 「9월 5일 (금) 10:00~12:00」 */
function formatSchedule(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  const head = start.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!endAt) return head;
  const end = new Date(endAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${head} ~ ${end}`;
}

function KeywordChips({
  field,
  options,
  tone,
}: {
  field: KeywordField | undefined;
  options: KeywordOption[];
  tone: "include" | "exclude" | "prepare";
}) {
  const items = [
    ...(field?.keys ?? []).map((k) => ({
      key: k,
      label: keywordLabel(options, k),
      emoji: options.find((o) => o.key === k)?.emoji ?? "",
    })),
    ...(field?.custom ?? []).map((c) => ({ key: `custom-${c}`, label: c, emoji: "" })),
  ];
  if (items.length === 0) return null;

  const cls =
    tone === "include"
      ? "bg-secondary text-secondary-foreground border-secondary-foreground/20"
      : tone === "exclude"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-muted text-foreground border-border";

  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((it) => (
        <span
          key={it.key}
          className={`rounded-full border px-4 py-2 text-sm font-bold ${cls}`}
        >
          {it.emoji && <span className="mr-1.5">{it.emoji}</span>}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export default function ProgramDetailPage() {
  const { id } = useParams();
  const [program, setProgram] = useState<DetailProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [introExpanded, setIntroExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // 로그인 없이도 게시된 프로그램을 봅니다. 미게시 프로그램은 소유자·관리자에게만
      // 내려오고 남에게는 not-found가 됩니다 — 존재 여부 자체를 알리지 않습니다.
      const res = await apiFetch<{ program: DetailProgram }>(`/programs/${id}`);
      setProgram(res.program);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "프로그램을 불러오지 못했습니다"
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-[1440px] px-5 py-10 sm:px-10">
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      </div>
    );
  }

  if (error || !program) {
    return (
      <div className="container mx-auto max-w-[1440px] px-5 py-10 sm:px-10">
        <p className="mb-3 text-sm">{error ?? "프로그램을 찾을 수 없습니다."}</p>
        <Link to="/search" className="text-sm text-muted-foreground underline">
          ← 프로그램 찾기로
        </Link>
      </div>
    );
  }

  const regionLabel = regionOfAddress(program.location.address);
  const hasCoords = program.location.lat != null && program.location.lng != null;
  const upcoming = program.schedules.filter((s) => new Date(s.startAt).getTime() > Date.now());
  const firstSchedule = upcoming[0];
  const introBlocks = program.introBlocks ?? [];
  const keywordCount =
    (program.includes?.keys.length ?? 0) +
    (program.includes?.custom.length ?? 0) +
    (program.excludes?.keys.length ?? 0) +
    (program.excludes?.custom.length ?? 0) +
    (program.preparations?.keys.length ?? 0) +
    (program.preparations?.custom.length ?? 0);

  return (
    <div className="container mx-auto max-w-[1440px] px-5 pb-20 pt-6 sm:px-10">
      {/* 미게시 프로그램을 소유자·관리자가 열었을 때 — 손님에게 보이는 화면과
          같아 보이면 "이미 공개됐다"고 오해합니다. */}
      {STATUS_NOTICE[program.status] && (
        <p className="mb-5 rounded-lg bg-secondary px-4 py-3 text-[13px] font-medium text-secondary-foreground">
          {STATUS_NOTICE[program.status]}
        </p>
      )}

      <Link to="/search" className="mb-4 inline-block text-sm text-muted-foreground">
        ← 프로그램 찾기
      </Link>

      {/* ── 상단: 사진 + 제목·가격·운영자 ─────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-8 border-b pb-8 lg:grid-cols-2">
        <ProgramGallery
          imageUrls={program.imageUrls ?? []}
          title={program.title}
          category={program.category}
        />

        <div className="flex flex-col gap-6 self-stretch">
          <div>
            <span className="text-[13px] font-bold text-primary">{program.category}</span>
            <h1 className="mt-2 text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
              {program.title}
            </h1>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold sm:text-4xl">
                {program.price.toLocaleString()}원
              </span>
              <span className="text-base text-muted-foreground">/ 1인</span>
            </div>
          </div>

          {/* 한눈에 보는 조건 — 시안의 배너 자리입니다. 「케어 무료 지원」처럼
              없는 기능을 약속하는 대신 실제 값을 넣었습니다(20-5). */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border px-5 py-4 text-[13.5px]">
            <div>
              <dt className="text-muted-foreground">인원</dt>
              <dd className="mt-0.5 font-bold">
                최소 {program.minCapacity}명 · 최대 {program.capacity}명
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">난이도</dt>
              <dd className="mt-0.5 font-bold">
                {DIFFICULTY_LABEL[program.difficulty ?? ""] ?? "정보 없음"}
                {program.walkingDistanceM != null && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (약 {(program.walkingDistanceM / 1000).toFixed(1)}km)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">참가 연령</dt>
              <dd className="mt-0.5 font-bold">
                {program.targetAgeMin == null && program.targetAgeMax == null
                  ? "제한 없음"
                  : `${program.targetAgeMin ?? 0}세 ~ ${program.targetAgeMax ?? "제한 없음"}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">우천 시</dt>
              <dd className="mt-0.5 font-bold">
                {RAIN_LABEL[program.rainAlternative] ?? "정보 없음"}
              </dd>
            </div>
            {program.barrierFree && (
              <div className="col-span-2">
                <dd className="font-bold text-primary">♿ 배리어프리(무장애) 코스입니다</dd>
              </div>
            )}
          </dl>

          {program.provider && (
            <div className="flex items-center gap-3 border-t pt-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-extrabold text-primary-foreground">
                {(program.provider.displayName ?? "품").slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-extrabold">
                  {program.provider.displayName ?? "운영자"}
                  {program.provider.verified && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                      인증
                    </span>
                  )}
                </p>
                {/* 평점은 리뷰가 있을 때만 보여줍니다 — 0.0점은 "나쁜 평가"로
                    읽힙니다(2-3의 같은 규칙). */}
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {program.provider.ratingCount > 0
                    ? `★ ${program.provider.ratingAvg.toFixed(1)} (후기 ${program.provider.ratingCount})`
                    : "후기가 아직 없습니다"}
                  {program.provider.bio ? ` · ${program.provider.bio}` : ""}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 포함 / 불포함 / 준비물 ────────────────────────────────────── */}
      {keywordCount > 0 && (
        <section className="flex flex-col gap-6 border-b py-8">
          {(program.includes?.keys.length ?? 0) + (program.includes?.custom.length ?? 0) > 0 && (
            <div>
              <h2 className="mb-3 text-base font-extrabold">포함 사항</h2>
              <KeywordChips field={program.includes} options={INCLUDE_OPTIONS} tone="include" />
            </div>
          )}
          {(program.excludes?.keys.length ?? 0) + (program.excludes?.custom.length ?? 0) > 0 && (
            <div>
              <h2 className="mb-3 text-base font-extrabold">불포함 사항</h2>
              <KeywordChips field={program.excludes} options={EXCLUDE_OPTIONS} tone="exclude" />
              <p className="mt-2 text-xs text-muted-foreground">
                위 항목은 참가비에 들어 있지 않습니다. 현장에서 따로 준비해 주세요.
              </p>
            </div>
          )}
          {(program.preparations?.keys.length ?? 0) +
            (program.preparations?.custom.length ?? 0) >
            0 && (
            <div>
              <h2 className="mb-3 text-base font-extrabold">준비물</h2>
              <KeywordChips
                field={program.preparations}
                options={PREPARATION_OPTIONS}
                tone="prepare"
              />
            </div>
          )}
        </section>
      )}

      {/* ── 프로그램 소개 ─────────────────────────────────────────────── */}
      <section className="border-b py-10">
        <h2 className="mb-7 text-xl font-extrabold">프로그램 소개</h2>

        <p className="mb-10 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed">
          {program.description}
        </p>

        {introBlocks.length > 0 && (
          <div className="relative">
            <div
              className={
                introExpanded ? "" : "max-h-[520px] overflow-hidden"
              }
            >
              <IntroBlockView blocks={introBlocks} />
            </div>

            {/* 접기는 블록이 여러 개일 때만 의미가 있습니다. 한 블록뿐인데
                가리면 "왜 잘렸지"만 남습니다. */}
            {!introExpanded && introBlocks.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 flex h-52 items-end justify-center bg-gradient-to-t from-background via-background/90 to-transparent">
                <Button variant="outline" size="lg" onClick={() => setIntroExpanded(true)}>
                  상세정보 더보기 ⌄
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 진행 날짜 ─────────────────────────────────────────────────── */}
      <section className="border-b py-10">
        <h2 className="mb-5 text-xl font-extrabold">진행 날짜</h2>

        {program.scheduleType === "open" ? (
          <div className="rounded-2xl border px-5 py-5">
            <p className="text-[15px] font-bold">날짜를 협의해서 정합니다</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              단체·기관 맞춤 프로그램입니다. 신청 후 채팅으로 일정을 협의합니다.
              {program.availableFrom && program.availableUntil && (
                <>
                  <br />
                  문의 가능 기간 {program.availableFrom} ~ {program.availableUntil}
                </>
              )}
            </p>
          </div>
        ) : upcoming.length === 0 ? (
          <p className="rounded-2xl border px-5 py-5 text-sm text-muted-foreground">
            지금은 예약할 수 있는 날짜가 없습니다. 새 일정이 열리면 이 자리에 표시됩니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {upcoming.map((s) => {
              const total = s.totalSlots ?? s.remainingSlots;
              const soldOut = s.remainingSlots <= 0;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4"
                >
                  <div>
                    <p className="text-[15px] font-bold">
                      {s.seriesIndex != null && (
                        <span className="mr-2 text-primary">{s.seriesIndex}회차</span>
                      )}
                      {formatSchedule(s.startAt, s.endAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {soldOut ? "마감되었습니다" : `남은 자리 ${s.remainingSlots}/${total}`}
                    </p>
                  </div>
                  {/* 예약·결제가 아직 없습니다. 「누를 데 없는 버튼을 두지 않는다」
                      (15-9)에 따라 눌리는 버튼 대신 상태만 적습니다. */}
                  <span className="text-[13px] font-semibold text-muted-foreground">
                    {soldOut ? "마감" : "예약 준비 중"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* 날씨는 첫 회차 기준입니다. 회차가 없으면 오늘 기준으로 보여줍니다. */}
        {hasCoords && (
          <div className="mt-6">
            <h3 className="mb-3 text-base font-extrabold">
              {firstSchedule ? "가장 이른 날짜의 날씨" : "오늘 날씨"}
            </h3>
            <WeatherWidget
              point={{
                lat: program.location.lat as number,
                lng: program.location.lng as number,
              }}
              regionLabel={regionLabel}
              date={firstSchedule ? new Date(firstSchedule.startAt) : undefined}
            />
          </div>
        )}
      </section>

      {/* ── 진행 장소 ─────────────────────────────────────────────────── */}
      <section className="py-10">
        <h2 className="mb-5 text-xl font-extrabold">진행하는 장소</h2>
        <div className="flex flex-col gap-4 rounded-2xl border p-5">
          {hasCoords ? (
            // 지도는 핀 하나만 찍습니다. `onSelect`를 넘기지 않으므로 핀을 눌러도
            // 카드가 열리지 않습니다 — 이미 그 프로그램의 상세 화면입니다.
            <ProgramMap
              programs={[
                // 지도가 실제로 읽는 것은 `id`·`location`·`price`뿐입니다.
                // 상세 응답을 그대로 넘기면 `createdAt` 같은 필드가 없어 타입이
                // 맞지 않으므로 필요한 만큼만 만들어 넘깁니다.
                {
                  ...program,
                  location: {
                    address: program.location.address,
                    lat: program.location.lat as number,
                    lng: program.location.lng as number,
                  },
                  createdAt: "",
                } as unknown as Program,
              ]}
              center={{
                lat: program.location.lat as number,
                lng: program.location.lng as number,
              }}
              className="h-64 rounded-xl"
            />
          ) : (
            <p className="rounded-xl bg-secondary px-4 py-8 text-center text-sm text-secondary-foreground">
              이 프로그램은 좌표가 저장되지 않아 지도를 표시할 수 없습니다.
              <br />
              운영자가 주소를 다시 검색해 저장하면 지도가 나타납니다.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-bold">📍 {program.location.address}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                정확한 집결 장소는 예약 확정 후 안내됩니다.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(program.location.address).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "복사했습니다" : "주소 복사"}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 안내 ──────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-2.5 border-t py-8">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">환불 정책 보기</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>환불 정책</DialogTitle>
            </DialogHeader>
            <p className="text-sm">7일 이상 전: 전액 환불 · 1~6일 전: 50% · 당일: 환불 없음</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              기준일은 진행일입니다. 천재지변·본인 질병·직계가족 상 등 면제 사유에 해당하면
              구간과 무관하게 전액 환불됩니다. 최소 인원이 모이지 않아 취소되는 경우에도 전액
              환불됩니다.
            </p>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">문의하기</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>문의하기</DialogTitle>
            </DialogHeader>
            <p className="text-sm leading-relaxed">
              1:1 문의는 예약 기능과 함께 준비 중입니다. 그때까지는 체질숲협동조합으로 직접
              연락해 주세요.
            </p>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
