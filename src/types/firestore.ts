// 품(FOOM) Firestore 스키마 기반 타입 정의
// 출처: FOOM_백엔드_설계_스키마_20260807.md (v6)
// 로그인/인증 관련 필드는 이 스프린트에서 제외 (users.role, authProvider 등은 다루지 않음)

export type QualificationType =
  | "forest_interpreter"
  | "infant_forest_instructor"
  | "mountain_trail_guide"
  | "forest_healing_instructor_1"
  | "forest_healing_instructor_2";

export type ScheduleType = "single" | "weekly" | "open" | "series";

export type ProgramStatus = "draft" | "pending_review" | "published" | "hidden";

/** 2-3 (v13) — 연령 태그 경계는 2-3 산출 기준표. 서버가 계산해 넣습니다 */
export type TargetAgeTag = "all" | "infant" | "child" | "teen" | "adult" | "senior";
/** 2-3 (v13) — 보행거리에서 서버가 산출 */
export type Difficulty = "easy" | "normal" | "hard";
/** 2-3 (v13) */
export type RainAlternative = "indoor" | "reschedule" | "none";
/** 4번 — 17개 시도 코드 */
export type Sido =
  | "seoul" | "busan" | "daegu" | "incheon" | "gwangju" | "daejeon" | "ulsan"
  | "sejong" | "gyeonggi" | "gangwon" | "chungbuk" | "chungnam" | "jeonbuk"
  | "jeonnam" | "gyeongbuk" | "gyeongnam" | "jeju";

// 2-3. programs (조회/등록에 필요한 필드만 — 스키마 문서 참고)
export interface Program {
  id: string;
  providerId: string;
  title: string;
  description: string;
  qualificationType: QualificationType;
  category: string;
  location: {
    address: string;
    lat: number;
    lng: number;
  };
  price: number;
  capacity: number;
  minCapacity: number;
  scheduleType: ScheduleType;
  availableFrom?: string | null; // open 타입 전용
  availableUntil?: string | null; // open 타입 전용
  imageUrls: string[];
  status: ProgramStatus;
  barrierFree: boolean;

  // ── 검색 필터·정렬용 (v13, 2-3) ──────────────────────────────────────
  // 아래 넷 중 `targetAgeTags`·`difficulty`·`sido`는 **서버가 계산해 넣는 파생
  // 필드**입니다. 화면은 읽기만 하고, 등록 폼에 입력칸을 만들지 않습니다.
  // 원본(`targetAgeMin`/`Max`·`walkingDistanceM`·주소)과 어긋나면 원본이 기준입니다.
  /** 참가 가능 연령(만 나이). null = 제한 없음 */
  targetAgeMin?: number | null;
  targetAgeMax?: number | null;
  /** 연령 필터 조회용 파생값. 둘 다 null인 경우에만 `['all']` */
  targetAgeTags?: TargetAgeTag[];
  /** 총 보행거리(m). 난이도 산출 근거이자 상세 표기용 */
  walkingDistanceM?: number | null;
  /** `walkingDistanceM`에서 서버가 산출 — 1km 이하 easy / 1~3km normal / 3km 초과 hard */
  difficulty?: Difficulty;
  /** 우천 시 대체 방식. **3값입니다** — 필터는 있냐/없냐로 받지만 표기는 구분합니다 */
  rainAlternative?: RainAlternative;
  /** 17개 시도 코드. 지역 필터는 주소 문자열이 아니라 이 값으로 판정합니다 */
  sido?: Sido;
  /** (v13, 2-3) 평점 캐시. 서버가 계산해 넣는 파생 필드라 화면은 읽기만 합니다.
   *  `ratingCount`가 0이면 **별점을 표시하지 않습니다** — 0.0점은 "나쁜 평가"로 읽힙니다 */
  ratingAvg?: number;
  ratingCount?: number;
  createdAt: string;
}

// 2-4. schedules (실제 예약 가능한 회차 — 목록/상세 화면에서 "날짜 선택"에 사용)
export interface ScheduleOccurrence {
  id: string;
  programId: string;
  type: ScheduleType;
  startAt: string;
  endAt?: string | null;
  seriesIndex?: number | null;
  seriesTotal?: number | null;
  remainingSlots: number;
}

// 2-2. providerProfiles (표시에 필요한 요약 정보만 — bankAccount 등 민감정보 제외)
export interface ProviderSummary {
  uid: string;
  name: string;
  bio: string;
  qualificationType: QualificationType[];
  ratingAvg: number;
  ratingCount: number;
  profileImageUrl?: string | null;
}

// 검색/목록 화면에서 쓰는 카테고리 상수
// 자격유형 공식명칭 5종으로 통일 (스키마 9-7 ⑥ — 2-2 qualificationType과 1:1 대응)
export const CATEGORIES = [
  "전체",
  "숲해설",
  "유아숲체험",
  "산림치유",
  "숲길등산",
  "단체·기업",
] as const;

export type Category = (typeof CATEGORIES)[number];
