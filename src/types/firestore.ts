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
  /** (v26, 20-4) 포함·불포함·준비물. `keys`는 목록 코드, `custom`은 직접 입력.
   *  **같은 항목을 `includes`와 `excludes`에 함께 넣을 수 없습니다**(서버가 거부) */
  includes?: { keys: string[]; custom: string[] };
  excludes?: { keys: string[]; custom: string[] };
  preparations?: { keys: string[]; custom: string[] };
  /** (v26, 20-2) 소개 블록 최대 5개. **배치는 저장하지 않습니다** — 사진 장수에서
   *  화면이 정합니다(1~2장 지그재그 / 3장 가로 전체 / 0장 문단) */
  introBlocks?: Array<{
    heading: string;
    body: string;
    images: Array<{ path: string; url: string }>;
  }>;
  /** (v25) `imageUrls`와 같은 순서로 짝을 이루는 버킷 경로. 서버 전용 */
  imagePaths?: string[];
  /** (2026-09-03, 20-6) 목록 카드용 작은 사진(긴 변 600px). `imageUrls`와 **같은
   *  자리**를 쓰는 짝 목록이고, 작은 판이 없는 사진은 빈 문자열입니다.
   *  **직접 읽지 말고 `cardImageUrl()`을 쓰세요** — 없을 때 큰 사진으로 되돌아갑니다 */
  thumbUrls?: string[];
  /** `thumbUrls`와 짝을 이루는 버킷 경로. 서버 전용 */
  thumbPaths?: string[];
  /** (v21, 2-3) 예약 가능한 미래 회차 날짜(`"2026-09-05"`, 오늘~+90일).
   *  하위 회차에서 **서버가 계산해 넣는 사본**입니다 — 화면은 읽기만 합니다.
   *  빈 배열이면 예약 가능한 날짜가 없는 프로그램입니다(상시모집은 항상 빈 배열) */
  scheduleDates?: string[];
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
  /** (v21) 이 회차의 원래 정원. 예약이 `remainingSlots`를 차감해도 "3/12"를
   *  표시할 수 있어야 하므로 두 벌로 둡니다 */
  totalSlots?: number;
  remainingSlots: number;
  /** (v4, 2-4) 최소인원 미달이어도 공급자가 강행 개설했는지 */
  forceOpen?: boolean;
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
