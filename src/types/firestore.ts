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
