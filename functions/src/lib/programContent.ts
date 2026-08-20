/**
 * 포함·불포함·준비물 키워드와 소개 블록 (스키마 20-2 · 20-4).
 *
 * **왜 자유 입력만 두지 않는가.** 「차 제공」·「음료 제공」·「다과」가 전부 다른 값이
 * 되면 검색 필터로 쓸 수 없고 표기도 제각각이 됩니다. 그래서 **미리 정한 목록에서
 * 고르고, 부족하면 직접 입력**합니다(20-4).
 *
 * **왜 상세 소개를 이미지 한 장으로 받지 않는가.** 국내 관행은 공급자가 상세페이지를
 * 이미지로 제작해 올리는 것이지만, 우리 공급자는 디자이너가 없는 개인 전문가이고,
 * 무엇보다 **v23의 수정 승인(바뀐 항목만 「전 → 후」)이 이미지 한 장 앞에서는
 * 무력화**됩니다 — 관리자가 매번 전체를 다시 봐야 합니다. 에어비앤비 체험도 자유
 * HTML 없이 구조화된 필드만 받습니다(20-1).
 *
 * ⚠️ **이 파일의 목록은 `src/lib/programContent.ts`와 같아야 합니다.**
 * 검색·필터를 서버로 모으기 전까지 두 벌을 두는 임시 구조이고, 한쪽만 고치면
 * 화면에 보이는 항목과 서버가 받는 항목이 갈립니다(`sido.ts`와 같은 사정).
 */

import { AppError } from "./errors";

/** 포함 사항 — 값은 저장용 코드이고 라벨은 화면에서 붙입니다. */
export const INCLUDE_KEYS = [
  "guide",
  "materials",
  "refreshment",
  "admission",
  "insurance",
  "souvenir",
  "photo",
  "equipment",
] as const;

/** 불포함 사항 */
export const EXCLUDE_KEYS = [
  "transport",
  "parking",
  "meal",
  "admission",
  "personal_gear",
] as const;

/** 준비물 */
export const PREPARATION_KEYS = [
  "shoes",
  "long_clothes",
  "hat",
  "water",
  "raincoat",
  "spare_clothes",
  "mat",
  "sunscreen",
  "insect_repellent",
] as const;

/** 구분마다 직접 입력할 수 있는 개수 (20-4). */
export const MAX_CUSTOM_ITEMS = 3;
const MAX_CUSTOM_LENGTH = 20;

/** 소개 블록 상한 (20-2). */
export const MAX_INTRO_BLOCKS = 5;
export const MAX_BLOCK_IMAGES = 3;
const MAX_HEADING = 30;
const MAX_BODY = 300;

export interface KeywordField {
  /** 목록에서 고른 코드 */
  keys: string[];
  /** 직접 입력한 문구. **심사 대상입니다** — 과장·허위가 들어갈 수 있습니다 */
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

function parseKeywordField(
  value: unknown,
  allowed: readonly string[],
  label: string
): KeywordField {
  const v = (value ?? {}) as Record<string, unknown>;

  const rawKeys = Array.isArray(v.keys) ? v.keys : [];
  const keys: string[] = [];
  for (const k of rawKeys) {
    const key = String(k);
    if (!allowed.includes(key)) {
      throw new AppError("invalid-argument", `${label}에 알 수 없는 항목이 있습니다`);
    }
    if (!keys.includes(key)) keys.push(key);
  }

  const rawCustom = Array.isArray(v.custom) ? v.custom : [];
  const custom: string[] = [];
  for (const c of rawCustom) {
    const text = typeof c === "string" ? c.trim() : "";
    if (text === "") continue;
    if (text.length > MAX_CUSTOM_LENGTH) {
      throw new AppError(
        "invalid-argument",
        `${label}에 직접 입력한 항목이 너무 깁니다(${MAX_CUSTOM_LENGTH}자 이내)`
      );
    }
    if (!custom.includes(text)) custom.push(text);
  }
  if (custom.length > MAX_CUSTOM_ITEMS) {
    throw new AppError(
      "invalid-argument",
      `${label}은 직접 입력을 ${MAX_CUSTOM_ITEMS}개까지 넣을 수 있습니다`
    );
  }

  return { keys, custom };
}

export interface ProgramContentInput {
  includes: KeywordField;
  excludes: KeywordField;
  preparations: KeywordField;
  introBlocks: IntroBlock[];
}

/**
 * 포함·불포함이 같은 항목을 동시에 가리키면 거부합니다.
 *
 * **`입장료`가 양쪽 목록에 모두 있습니다**(20-4). 「입장료 포함」과 「입장료 불포함」이
 * 함께 표시되면 손님은 어느 쪽을 믿어야 할지 알 수 없고, 그 상태로 결제가 일어나면
 * 분쟁이 됩니다. 직접 입력한 문구도 같은 기준으로 봅니다.
 */
function assertNoContradiction(includes: KeywordField, excludes: KeywordField): void {
  const overlapKeys = includes.keys.filter((k) => excludes.keys.includes(k));
  const overlapCustom = includes.custom.filter((c) => excludes.custom.includes(c));

  if (overlapKeys.length > 0 || overlapCustom.length > 0) {
    throw new AppError(
      "invalid-argument",
      "같은 항목을 포함과 불포함에 함께 넣을 수 없습니다. 한쪽만 골라 주세요"
    );
  }
}

/** 소개 블록 파싱. 사진 경로 검증은 저장 직전에 별도로 합니다(비동기라서). */
function parseIntroBlocks(value: unknown): IntroBlock[] {
  const raw = value == null ? [] : value;
  if (!Array.isArray(raw)) {
    throw new AppError("invalid-argument", "소개 블록 형식이 올바르지 않습니다");
  }
  if (raw.length > MAX_INTRO_BLOCKS) {
    throw new AppError(
      "invalid-argument",
      `소개 블록은 ${MAX_INTRO_BLOCKS}개까지 만들 수 있습니다`
    );
  }

  const blocks = raw.map((item, i) => {
    const b = (item ?? {}) as Record<string, unknown>;
    const label = `${i + 1}번째 소개 블록`;

    const heading = typeof b.heading === "string" ? b.heading.trim() : "";
    const body = typeof b.body === "string" ? b.body.trim() : "";

    if (heading.length > MAX_HEADING) {
      throw new AppError("invalid-argument", `${label}의 소제목이 너무 깁니다(${MAX_HEADING}자 이내)`);
    }
    if (body.length > MAX_BODY) {
      throw new AppError("invalid-argument", `${label}의 설명이 너무 깁니다(${MAX_BODY}자 이내)`);
    }

    const rawImages = Array.isArray(b.images) ? b.images : [];
    if (rawImages.length > MAX_BLOCK_IMAGES) {
      throw new AppError(
        "invalid-argument",
        `${label}의 사진은 ${MAX_BLOCK_IMAGES}장까지 넣을 수 있습니다`
      );
    }
    const images = rawImages.map((img, j) => {
      const row = (img ?? {}) as Record<string, unknown>;
      const path = typeof row.path === "string" ? row.path.trim() : "";
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (path === "" || url === "") {
        throw new AppError("invalid-argument", `${label}의 ${j + 1}번째 사진 정보가 올바르지 않습니다`);
      }
      return { path, url };
    });

    // 사진도 글도 없는 블록은 화면에 아무것도 그리지 않습니다.
    if (heading === "" && body === "" && images.length === 0) {
      throw new AppError("invalid-argument", `${label}이 비어 있습니다. 지우거나 채워 주세요`);
    }
    // 사진만 있고 글이 없으면 무슨 사진인지 알 수 없습니다.
    if (heading === "" && body === "") {
      throw new AppError("invalid-argument", `${label}에 소제목이나 설명을 넣어 주세요`);
    }

    return { heading, body, images };
  });

  return blocks;
}

/** 요청 본문 → 소개·키워드 필드. 허용목록 밖의 값은 여기서 사라집니다. */
export function parseProgramContent(body: unknown): ProgramContentInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const includes = parseKeywordField(b.includes, INCLUDE_KEYS, "포함 사항");
  const excludes = parseKeywordField(b.excludes, EXCLUDE_KEYS, "불포함 사항");
  const preparations = parseKeywordField(b.preparations, PREPARATION_KEYS, "준비물");

  assertNoContradiction(includes, excludes);

  return {
    includes,
    excludes,
    preparations,
    introBlocks: parseIntroBlocks(b.introBlocks),
  };
}

/** 소개 블록에 들어 있는 사진 경로 전부 */
export function introBlockPaths(blocks: IntroBlock[]): string[] {
  return blocks.flatMap((b) => b.images.map((i) => i.path));
}

/** 빈 값 — 등록 시 명시적으로 넣습니다(필드가 없으면 화면이 undefined를 만납니다). */
export function emptyProgramContent(): ProgramContentInput {
  return {
    includes: { keys: [], custom: [] },
    excludes: { keys: [], custom: [] },
    preparations: { keys: [], custom: [] },
    introBlocks: [],
  };
}
