import type { LucideIcon } from "lucide-react";
import {
  Baby,
  LayoutGrid,
  Leaf,
  Mountain,
  Sprout,
  Users,
} from "lucide-react";
import type { Category } from "@/types/firestore";

/**
 * 카테고리별 아이콘·타일 색.
 * 마인드카페 홈처럼 "연한 타일 + 라인 아이콘" 조합으로 균등 배치하기 위한 메타데이터입니다.
 * 색은 브랜드 그린(#1F5C43) 주변의 자연 톤으로 묶었습니다.
 */
export interface CategoryMeta {
  key: Category;
  label: string;
  icon: LucideIcon;
  /** 타일 배경 */
  tile: string;
  /** 아이콘 색 */
  ink: string;
}

// 카테고리 명칭은 자격유형 공식명칭 5종 (스키마 9-7 ⑥)
export const CATEGORY_META: CategoryMeta[] = [
  { key: "전체", label: "전체", icon: LayoutGrid, tile: "#EDF1EF", ink: "#4B5D55" },
  { key: "숲해설", label: "숲해설", icon: Sprout, tile: "#E9F0DA", ink: "#4A6B1E" },
  { key: "유아숲체험", label: "유아숲체험", icon: Baby, tile: "#FBEEDC", ink: "#8A5A16" },
  { key: "산림치유", label: "산림치유", icon: Leaf, tile: "#E1EFE7", ink: "#1F5C43" },
  { key: "숲길등산", label: "숲길등산", icon: Mountain, tile: "#E3EDF3", ink: "#2A5B72" },
  { key: "단체·기업", label: "단체·기업", icon: Users, tile: "#EDEAF5", ink: "#4C4380" },
];
