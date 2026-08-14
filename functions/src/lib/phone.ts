/**
 * 전화번호 정규화 (스키마 15-4, 2-1).
 *
 * 저장은 **E.164 한 형식으로만** 합니다. `010-1234-5678`과 `+821012345678`을
 * 섞어 저장하면 같은 번호인데 다른 문자열이 되어 중복 검사가 통째로 무력해집니다.
 *
 * 소셜에서 받은 번호와 사용자가 예약 화면에서 직접 입력한 번호가 **반드시 이
 * 함수 하나를 거쳐야** 합니다. 경로마다 각자 정규화하면 규칙이 미묘하게 달라집니다.
 */

/** 정규화 실패 사유 — 화면에 무엇이 잘못됐는지 알려주기 위해 구분합니다. */
export type PhoneNormalizeError = "empty" | "not_numeric" | "bad_length" | "not_kr";

export interface PhoneNormalizeResult {
  ok: boolean;
  /** 성공 시 E.164 (`+8210...`) */
  e164?: string;
  error?: PhoneNormalizeError;
}

/**
 * 한국 번호를 E.164로 바꿉니다.
 *
 * 받아들이는 입력: `010-1234-5678` / `01012345678` / `+82 10 1234 5678` /
 * `821012345678` / `02-123-4567`(유선)
 *
 * 국제번호 일반을 다루지 않는 이유: 알림톡·SMS 발송 대상이 국내 번호이고,
 * 범용 파서를 직접 만들면 예외 처리가 끝없이 늘어납니다. 해외 번호가 실제로
 * 필요해지면 libphonenumber로 교체합니다.
 */
export function normalizePhone(raw: string | null | undefined): PhoneNormalizeResult {
  if (raw == null) return { ok: false, error: "empty" };

  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };

  // 하이픈·공백·괄호·점만 허용해 걷어냅니다. 그 외 문자가 있으면 잘못된 입력입니다.
  if (/[^0-9+\-\s().]/.test(trimmed)) return { ok: false, error: "not_numeric" };

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return { ok: false, error: "not_numeric" };

  let national: string;
  if (hadPlus || digits.startsWith("82")) {
    if (!digits.startsWith("82")) return { ok: false, error: "not_kr" };
    national = digits.slice(2);
    // +82 표기에서는 국내 통화용 앞자리 0을 뺀 형태가 정상입니다(+82 10 ...).
    // 간혹 +82 010 ... 처럼 0을 남긴 값이 들어오므로 함께 걷어냅니다.
    national = national.replace(/^0+/, "");
  } else if (digits.startsWith("0")) {
    national = digits.replace(/^0+/, "");
  } else {
    // 0으로 시작하지 않는 국내 번호 표기는 없습니다.
    return { ok: false, error: "not_kr" };
  }

  // 국내 번호는 지역번호/사업자 식별번호를 빼면 8~10자리입니다.
  if (national.length < 8 || national.length > 10) {
    return { ok: false, error: "bad_length" };
  }

  return { ok: true, e164: `+82${national}` };
}

/** 휴대전화(01x)인지 — 알림톡 발송 대상 판별용. */
export function isMobile(e164: string): boolean {
  return /^\+821[0-9]{8,9}$/.test(e164);
}

/**
 * 로그에 남길 수 있는 마스킹 형태.
 * **원본 번호를 로그에 찍지 마세요** — 저장하지 않기로 한 값과 같은 기준입니다(2-1).
 */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return "***";
  return `${e164.slice(0, 6)}****${e164.slice(-2)}`;
}
