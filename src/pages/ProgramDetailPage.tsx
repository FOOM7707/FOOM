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

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ProgramMap from "../components/ProgramMap";
import WeatherWidget from "../components/WeatherWidget";
import ProgramGallery from "../components/ProgramGallery";
import IntroBlockView from "../components/IntroBlockView";
import BookingDrawer from "../components/BookingDrawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { localityOfAddress } from "@/lib/geo";
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
  /** (20-6) 목록·옆칸용 작은 사진. 없으면 큰 사진으로 되돌아갑니다 */
  thumbUrls?: string[];
  includes?: KeywordField;
  excludes?: KeywordField;
  preparations?: KeywordField;
  introBlocks?: IntroBlock[];
  /** 소개 배치 양식 (v29). 값이 없는 옛 문서는 양식 1로 그립니다 */
  introLayout?: string;
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
  // 날짜 선택 서랍 (20-5). 하단 「참여하기」나 회차 목록의 「날짜 선택」이 엽니다 —
  // 후자는 그 회차가 선택된 채 열립니다.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preselectId, setPreselectId] = useState<string | null>(null);

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

  /**
   * 오른쪽 예약 카드가 화면에 보이는지 지켜봅니다.
   *
   * 카드는 「진행하는 장소」 앞 실선에서 멈추므로, 지도까지 내려가면 신청할 방법이
   * 화면에서 사라집니다. 그때 아래 고정 바가 올라오게 하기 위한 값입니다.
   * (좁은 화면에는 카드 자체가 없고 고정 바가 늘 떠 있으므로 이 값을 쓰지 않습니다.)
   */
  const bookingCardRef = useRef<HTMLElement | null>(null);
  const [cardInView, setCardInView] = useState(true);

  useEffect(() => {
    const node = bookingCardRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => setCardInView(entry.isIntersecting),
      // 카드가 조금이라도 보이면 「보인다」로 봅니다 — 살짝 걸쳐 있을 때 고정 바가
      // 나타났다 사라졌다 깜빡이면 그게 더 거슬립니다.
      { threshold: 0 }
    );
    io.observe(node);
    return () => io.disconnect();
    // 프로그램이 바뀌면(다른 상세로 이동) 다시 붙입니다.
  }, [program?.id]);

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

  // 「경기」가 아니라 「수원시 팔달구 화서동」으로 보여줍니다(v29).
  const regionLabel = localityOfAddress(program.location.address);
  const hasCoords = program.location.lat != null && program.location.lng != null;


  /**
   * 길찾기 — 카카오맵으로 넘깁니다. 우리가 이미 카카오맵을 쓰고 있어 화면과 목적지가
   * 같은 지도로 이어지고, 휴대폰에서는 앱이 설치돼 있으면 앱이 열립니다.
   *
   * **좌표가 없는 옛 프로그램도 버튼이 동작해야 합니다** — v18 이전에 등록된
   * 프로그램은 좌표가 비어 있습니다(19-6). 그 경우 주소로 검색해서 보냅니다.
   */
  const directionsUrl = hasCoords
    ? `https://map.kakao.com/link/to/${encodeURIComponent(program.title)},${program.location.lat},${program.location.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(program.location.address)}`;
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

  // 하단 고정 바의 「참여하기」 — 상시모집은 협의 안내로, 회차가 있으면 날짜 선택으로
  // 이어집니다. 고를 날짜가 없으면 비활성으로 이유를 적습니다(15-9 — 눌리는 척 금지).
  const canParticipate = program.scheduleType === "open" || upcoming.length > 0;

  return (
    // pb-32: 하단 고정 바가 마지막 내용(문의하기 버튼)을 가리지 않을 만큼 띄웁니다.
    <div className="container mx-auto max-w-[1440px] px-5 pb-32 pt-6 sm:px-10 lg:pb-16">
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

      {/* ── 데스크톱 2:1 분할 ────────────────────────────────────────────
          왼쪽(2)은 읽는 내용, 오른쪽(1)은 신청에 필요한 것만 모아 따라다닙니다.
          **휴대폰에서는 한 줄로 쌓이고 하단 고정 버튼이 그대로 남습니다** — 좁은
          화면에는 오른쪽 칸이 없어 버튼이 사라지면 신청할 방법이 없어집니다. */}
      {/* 상단: 사진(왼쪽 2) + 나중에 채울 자리(오른쪽 1) (2026-09-03).
          아래 내용 그리드와 **같은 2:1 비율**이라 사진과 가격 카드가 세로로
          정렬됩니다. **오른쪽 위는 지금 비워둡니다** — 넣을 내용이 정해지면
          여기에 채웁니다. 휴대폰(lg 미만)에서는 한 줄로 쌓이고 사진이 가로
          전체를 쓰며, 빈 칸은 나타나지 않습니다(`hidden lg:block`). */}
      <div className="grid items-start gap-10 lg:grid-cols-[2fr_1fr] lg:gap-12">
        <div className="min-w-0">
          <ProgramGallery
            imageUrls={program.imageUrls ?? []}
            thumbUrls={program.thumbUrls}
            title={program.title}
            category={program.category}
          />
        </div>
        <div className="hidden lg:block" aria-hidden />
      </div>

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[2fr_1fr] lg:gap-12">
        {/* ── 왼쪽: 읽는 내용 ──────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="border-b pb-8">
            <span className="text-[13px] font-bold text-primary">{program.category}</span>
            <h1 className="mt-2 text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
              {program.title}
            </h1>
            {/* 가격은 오른쪽 카드가 맡습니다. 다만 휴대폰에서는 오른쪽 칸이 맨 아래로
                내려가므로, 좁은 화면에서만 여기에도 보여줍니다. */}
            <div className="mt-4 flex items-baseline gap-2 lg:hidden">
              <span className="text-3xl font-extrabold">
                {program.price.toLocaleString()}원
              </span>
              <span className="text-base text-muted-foreground">/ 1인</span>
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
                  <IntroBlockView blocks={introBlocks} layout={program.introLayout} />
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
          <section className="py-10">
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
                      {/* 날짜 선택 서랍이 생겨(20-5) 이제 누를 데가 있습니다 — 누르면
                          이 회차가 선택된 채 서랍이 열립니다. 마감은 상태만 적습니다. */}
                      {soldOut ? (
                        <span className="text-[13px] font-semibold text-muted-foreground">마감</span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPreselectId(s.id);
                            setDrawerOpen(true);
                          }}
                        >
                          날짜 선택
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 날씨는 첫 회차 기준입니다. 회차가 없으면 오늘 기준으로 보여줍니다. */}
            {hasCoords && (
              <div className="mt-6">
                {/* 날짜는 위젯이 직접 밝히므로 제목에서 뺐습니다 — 같은 말이 두 번
                    나오면 어느 쪽이 기준인지 오히려 헷갈립니다. */}
                <h3 className="mb-1 text-base font-extrabold">참고용 날씨</h3>
                <p className="mb-3 text-[12.5px] text-muted-foreground">
                  {firstSchedule
                    ? "가장 이른 날짜 기준입니다. 진행일이 3~4일 이상 남았으면 예보가 아직 없습니다"
                    : "등록된 날짜가 없어 오늘 기준으로 보여드립니다"}
                </p>
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

        </div>

        {/* ── 오른쪽: 신청에 필요한 것 ─────────────────────────────────────
            스크롤해도 따라옵니다(`sticky`). 헤더가 60px이라 그만큼 띄웁니다. */}
        {/* min-w-0: 모바일 1열에서 이 칸이 내용보다 안 줄어드는 grid 기본 동작
            때문에 가로로 넘치지 않게 합니다(왼쪽 칸과 같은 처리). */}
        <aside ref={bookingCardRef} className="min-w-0 lg:sticky lg:top-[84px]">
          <div className="flex flex-col gap-5 rounded-2xl border p-6 shadow-[0_4px_20px_rgba(31,92,67,0.07)]">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] font-extrabold leading-none">
                  {program.price.toLocaleString()}원
                </span>
                <span className="text-sm text-muted-foreground">/ 1인</span>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {program.scheduleType === "open"
                  ? "날짜를 협의해서 정하는 프로그램입니다"
                  : firstSchedule
                    ? `가장 이른 날짜 ${formatSchedule(firstSchedule.startAt, firstSchedule.endAt)}`
                    : "예약할 수 있는 날짜가 없습니다"}
              </p>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!canParticipate}
              onClick={() => {
                setPreselectId(null);
                setDrawerOpen(true);
              }}
            >
              {canParticipate ? "참여하기" : "예약 가능한 날짜 없음"}
            </Button>

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

            {/* 환불 정책과 문의는 신청을 결정할 때 확인하는 것이라 버튼 옆에 둡니다 —
                예전에는 페이지 맨 아래에 있어 끝까지 내려가야 보였습니다. */}
            <div className="flex flex-wrap gap-2 border-t pt-4">
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
            </div>
          </div>
        </aside>
      </div>

      {/* ── 진행 장소 ────────────────────────────────────────────────────
          **격자 밖입니다.** 위 2:1 구간이 여기서 끝나므로 오른쪽 예약 카드도 이
          실선에서 멈추고, 카드가 비우고 간 자리를 지도가 가로 전체로 채웁니다. */}
      <section className="border-t py-10">
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
              className="h-[380px] rounded-xl md:h-[480px]"
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
              <p className="flex items-center gap-1.5 text-[15px] font-bold"><MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />{program.location.address}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                정확한 집결 장소는 예약 확정 후 안내됩니다.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
              {/* 새 탭으로 엽니다 — 지금 보던 프로그램 화면을 잃지 않아야 합니다. */}
              <Button size="sm" asChild>
                <a href={directionsUrl} target="_blank" rel="noreferrer noopener">
                  <Navigation className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  길찾기
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 하단 고정 「참여하기」 (20-5) ─────────────────────────────────
          시안의 하단 고정 CTA입니다. 날짜 선택까지 실제로 동작하고, 결제 자리에만
          「준비 중」이 들어갑니다 — 예약이 붙는 날 그대로 씁니다. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur",
          // 넓은 화면: 오른쪽 카드가 보이는 동안에는 아래로 내려가 숨습니다.
          // `invisible`을 함께 주는 것은 화면 밖 버튼이 키보드 이동 순서에 남지
          // 않게 하기 위함입니다. 좁은 화면에서는 늘 떠 있습니다.
          "transition-[transform,visibility] duration-300 ease-out",
          cardInView && "lg:invisible lg:translate-y-full"
        )}
      >
        <div className="container mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-3.5 sm:px-10">
          {/* min-w-0: 좁은 화면에서 이 텍스트 칸이 내용 폭 아래로 줄어들 수 있게
              합니다. 없으면 긴 날짜 문구가 안 줄고, 오른쪽 고정폭 버튼과 합쳐
              바가 화면 밖으로 넘쳐 페이지 전체가 좌우로 밀립니다. 날짜는 넘치면
              말줄임(truncate)으로 자릅니다. */}
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold leading-tight">
              {program.price.toLocaleString()}원
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ 1인</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {program.scheduleType === "open"
                ? "날짜를 협의해서 정하는 프로그램입니다"
                : firstSchedule
                  ? `가장 이른 날짜 ${formatSchedule(firstSchedule.startAt, firstSchedule.endAt)}`
                  : "예약할 수 있는 날짜가 없습니다"}
            </p>
          </div>
          <Button
            size="lg"
            className="min-w-[160px] shrink-0"
            disabled={!canParticipate}
            onClick={() => {
              setPreselectId(null);
              setDrawerOpen(true);
            }}
          >
            {canParticipate ? "참여하기" : "예약 가능한 날짜 없음"}
          </Button>
        </div>
      </div>

      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        price={program.price}
        scheduleType={program.scheduleType}
        availableFrom={program.availableFrom}
        availableUntil={program.availableUntil}
        schedules={upcoming}
        initialSelectedId={preselectId}
      />
    </div>
  );
}
