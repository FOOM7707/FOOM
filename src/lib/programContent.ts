/**
 * 포함·불포함·준비물 목록과 소개 블록 상한 (스키마 20-2 · 20-4).
 *
 * ⚠️ **`functions/src/lib/programContent.ts`의 사본입니다.** 코드는 서버가 기준이고,
 * 여기 목록이 서버와 다르면 **화면에서 고른 항목이 저장될 때 거부됩니다.**
 * `sido.ts`와 같은 임시 구조입니다 — 한쪽만 고치지 마세요.
 *
 * 코드값을 저장하고 라벨은 화면에서 붙입니다. 나중에 문구를 다듬어도 이미 저장된
 * 프로그램을 건드릴 필요가 없습니다.
 */

export interface KeywordOption {
  key: string;
  label: string;
  /** 목록에서 눈에 띄게 하는 용도. 저장하지 않습니다 */
  emoji: string;
}

export const INCLUDE_OPTIONS: KeywordOption[] = [
  { key: "guide", label: "전문가 해설", emoji: "🌲" },
  { key: "materials", label: "체험 재료", emoji: "🧺" },
  { key: "refreshment", label: "다과·차", emoji: "☕" },
  { key: "admission", label: "입장료", emoji: "🎟️" },
  { key: "insurance", label: "보험", emoji: "🛡️" },
  { key: "souvenir", label: "기념품", emoji: "🎁" },
  { key: "photo", label: "사진 촬영", emoji: "📷" },
  { key: "equipment", label: "장비 대여", emoji: "🎒" },
];

export const EXCLUDE_OPTIONS: KeywordOption[] = [
  { key: "transport", label: "교통비", emoji: "🚌" },
  { key: "parking", label: "주차비", emoji: "🅿️" },
  { key: "meal", label: "식사", emoji: "🍚" },
  { key: "admission", label: "입장료", emoji: "🎟️" },
  { key: "personal_gear", label: "개인 장비", emoji: "🥾" },
];

export const PREPARATION_OPTIONS: KeywordOption[] = [
  { key: "shoes", label: "편한 신발", emoji: "👟" },
  { key: "long_clothes", label: "긴 옷", emoji: "👕" },
  { key: "hat", label: "모자", emoji: "🧢" },
  { key: "water", label: "물", emoji: "💧" },
  { key: "raincoat", label: "우비", emoji: "🌧️" },
  { key: "spare_clothes", label: "여벌 옷", emoji: "🧦" },
  { key: "mat", label: "돗자리", emoji: "🧶" },
  { key: "sunscreen", label: "자외선 차단제", emoji: "🧴" },
  { key: "insect_repellent", label: "벌레 기피제", emoji: "🦟" },
];

/** 서버 상한과 같은 값이어야 합니다. */
export const MAX_CUSTOM_ITEMS = 3;
export const MAX_INTRO_BLOCKS = 5;
/** 블록마다 사진 1장 — 「사진 한 장 + 글」이 한 칸입니다(v29에서 3장 → 1장) */
export const MAX_BLOCK_IMAGES = 1;
export const MAX_HEADING_LENGTH = 30;
export const MAX_BODY_LENGTH = 300;

/** 상세 소개 배치 양식. 서버 목록과 같아야 합니다(v29) */
export const INTRO_LAYOUTS = ["zigzag"] as const;
export type IntroLayout = (typeof INTRO_LAYOUTS)[number];
export const DEFAULT_INTRO_LAYOUT: IntroLayout = "zigzag";

export interface KeywordField {
  keys: string[];
  custom: string[];
}

export interface IntroBlockImage {
  path: string;
  url: string;
}

export interface IntroBlock {
  heading: string;
  body: string;
  images: IntroBlockImage[];
}

export function emptyKeywordField(): KeywordField {
  return { keys: [], custom: [] };
}

export function emptyIntroBlock(): IntroBlock {
  return { heading: "", body: "", images: [] };
}

/** 코드 → 라벨. 저장된 코드가 목록에서 사라졌더라도 코드를 그대로 보여줍니다. */
export function keywordLabel(options: KeywordOption[], key: string): string {
  return options.find((o) => o.key === key)?.label ?? key;
}
