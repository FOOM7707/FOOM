import type { ProviderSummary } from "../types/firestore";

export const mockProviders: ProviderSummary[] = [
  {
    uid: "provider-001",
    name: "체질숲 협동조합",
    bio: "국립자연휴양림 인근에서 10년간 숲해설·산림치유 프로그램을 운영해온 협동조합입니다.",
    qualificationType: ["forest_healing_instructor_1", "forest_interpreter"],
    ratingAvg: 4.8,
    ratingCount: 132,
    profileImageUrl: null,
  },
  {
    uid: "provider-002",
    name: "초록숨 유아숲학교",
    bio: "3~7세 유아 대상 숲체험 전문. 인증 유아숲지도사만 배정됩니다.",
    qualificationType: ["infant_forest_instructor"],
    ratingAvg: 4.6,
    ratingCount: 58,
    profileImageUrl: null,
  },
  {
    uid: "provider-003",
    name: "산길안내 트레킹클럽",
    bio: "국가공인 산길안내인이 함께하는 안전 중심 숲길등산 프로그램.",
    qualificationType: ["mountain_trail_guide"],
    ratingAvg: 4.9,
    ratingCount: 201,
    profileImageUrl: null,
  },
];
