/**
 * 프로그램 수정의 「무엇이 바뀌었나」 판정과 변경 기록 (2026-09-09 ⑨ 개정).
 *
 * v23~v37에는 여기에 **수정본(pendingEdit)** 흐름이 있었습니다 — 게시 중인 프로그램의
 * 심사 대상 항목을 고치면 수정본으로 따로 보관하고 관리자가 승인하면 게시본과 교체하는
 * 방식. ⑨에서 내용 심사를 없애면서(게시 중 수정은 바로 반영) 그 흐름은 지웠고, 남은 것은
 *
 *  1. 심사 대상 / 즉시 반영 항목의 분류 — 관리자가 숨긴 프로그램을 고쳤을 때 무엇이 바뀌었는지
 *     보여주고, 「다시 올리기」 문서 서술의 근거로 쓰입니다.
 *  2. **변경 기록**(`programs/{id}/history`) — 게시 중 수정이 즉시 반영되므로 「어제까지 무슨
 *     내용으로 팔았나」를 아무도 확인하지 않게 됩니다. 관리자 감시 목록이 이 기록을 「전 → 후」로
 *     보여주고, 표시·광고 기록 6개월 보존(전자상거래법 시행령 6조)과 분쟁 시 「손님이 봤을 때
 *     가격이 얼마였나」에 답하는 근거가 됩니다. 사후 검수는 기록이 있어야 성립합니다.
 *
 * 이 파일은 `programs.ts`가 import하므로 `programs.ts`를 import하지 않습니다(순환 참조).
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
// 타입만 가져옵니다 — 타입 import는 컴파일 후 사라지므로 순환 참조가 생기지 않습니다.
import type { ProgramDraftInput } from "./programs";

/**
 * 즉시 반영 항목 — 운영 정보라 관리자 확인 없이 반영되는 것. ⑨ 이후 이 목록의 뜻은
 * 「관리자가 숨긴 프로그램을 고칠 때도 심사로 넘기지 않아도 되는 항목」이 아니라(그 경우는
 * 무엇을 고쳐도 심사로 감 — 페널티), 화면 문구와 문서(2-3·5번)가 가리키는 분류 기준입니다.
 */
export const NON_REVIEW_FIELDS = new Set([
  "barrierFree",
  "rainAlternative",
  "walkingDistanceM",
  "availableFrom",
  "availableUntil",
  // 소개 배치 양식(v29). **보기 방식이고 내용이 아닙니다.**
  "introLayout",
]);

/** 두 값이 같은지 (location처럼 객체인 필드도 비교합니다) */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** 바뀐 항목 전부 — 변경 기록과 「바뀐 항목 N개」 표시에 씁니다. */
export function changedFieldsAll(
  before: Record<string, unknown>,
  after: ProgramDraftInput
): string[] {
  return (Object.keys(after) as Array<keyof ProgramDraftInput>).filter(
    (key) => !sameValue(before[key], after[key])
  ) as string[];
}

/** 바뀐 항목 중 심사 대상(즉시 반영 항목 제외)만 */
export function changedReviewFields(
  before: Record<string, unknown>,
  after: ProgramDraftInput
): string[] {
  return changedFieldsAll(before, after).filter((key) => !NON_REVIEW_FIELDS.has(key));
}

/** 심사 대상 필드가 바뀌었는지 */
export function needsRereview(
  before: Record<string, unknown>,
  after: ProgramDraftInput
): boolean {
  return changedReviewFields(before, after).length > 0;
}

/** 옛 수정본 문서 경로 — v37 이전에 만들어진 것을 정리할 때만 씁니다. */
export function pendingEditPath(programId: string): string {
  return `programs/${programId}/pendingEdit/current`;
}

/**
 * 옛 수정본 폐기. 내리기·삭제·관리자 숨김 경로가 부릅니다 — ⑨ 이전에 만들어진 수정본이
 * 남아 있으면 나중에 되살릴 때 게시본과 수정본 중 어느 쪽이 기준인지 알 수 없어집니다.
 */
export async function discardPendingEdit(db: Firestore, programId: string): Promise<void> {
  await db
    .doc(pendingEditPath(programId))
    .delete()
    .catch(() => undefined);
}

export interface ProgramHistoryEntry extends Record<string, unknown> {
  /** 바뀐 항목 이름 */
  fields: string[];
  /** 바뀌기 전 값 — `fields`에 적힌 항목만 */
  before: Record<string, unknown>;
  /** 바뀐 뒤 값 — 같은 항목 */
  after: Record<string, unknown>;
  /** 고친 사람(공급자 uid) */
  changedBy: string;
  changedAt: unknown;
  /** 바뀔 당시 프로그램 상태 — 게시 중 수정만 기록하므로 지금은 항상 `published` */
  status: string;
}

/**
 * 변경 기록 한 건. **바뀐 항목만** 전·후로 남깁니다 — 문서를 통째로 두 번 저장하면 소개
 * 300자·사진 5장이 수정마다 복사되고, 관리자는 그 안에서 무엇이 바뀌었는지 못 찾습니다.
 * 읽기는 소유자·관리자만, 쓰기는 서버 전용(보안규칙).
 */
export async function recordProgramHistory(
  db: Firestore,
  programId: string,
  changedBy: string,
  before: Record<string, unknown>,
  after: ProgramDraftInput,
  fields: string[]
): Promise<void> {
  if (fields.length === 0) return;
  const beforePart: Record<string, unknown> = {};
  const afterPart: Record<string, unknown> = {};
  for (const key of fields) {
    beforePart[key] = before[key] ?? null;
    afterPart[key] = (after as unknown as Record<string, unknown>)[key] ?? null;
  }
  await db.collection(`programs/${programId}/history`).add({
    fields,
    before: beforePart,
    after: afterPart,
    changedBy,
    changedAt: FieldValue.serverTimestamp(),
    status: (before.status as string) ?? "published",
  });
}

/** 가장 최근 변경 기록 한 건. 없으면 null. 관리자 감시 목록이 씁니다. */
export async function latestProgramHistory(
  db: Firestore,
  programId: string
): Promise<(ProgramHistoryEntry & { id: string }) | null> {
  const snap = await db
    .collection(`programs/${programId}/history`)
    .orderBy("changedAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as ProgramHistoryEntry) };
}
