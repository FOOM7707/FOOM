/**
 * 올리기 전에 브라우저에서 사진을 줄입니다 (스키마 20-6).
 *
 * **여기서 줄이지 않으면 비용이 10배 이상 뜁니다.** 요즘 휴대폰 사진은 장당 4MB
 * 정도인데, 프로그램 하나에 20장까지 붙을 수 있습니다. 원본을 그대로 서빙하면
 * 상세 페이지 한 번 보는 데 80MB가 나가고, 그 사실은 **요금 청구로만 드러납니다.**
 *
 * 서버(Cloud Functions)나 Firebase 확장으로 줄이는 방법도 있지만 여기서 하는 편이
 * 낫습니다 — ① 서버 비용이 아예 들지 않고 ② 업로드 자체가 빨라지고 ③ 저장 규칙의
 * 5MB 상한을 항상 통과하고 ④ 확장 설치(콘솔 작업)에 의존하지 않습니다.
 *
 * **EXIF 회전은 브라우저가 처리합니다.** `createImageBitmap`은 방향 정보를 반영해
 * 디코딩하므로, 세로로 찍은 사진이 눕는 문제가 생기지 않습니다.
 */

/** 긴 변 최대 길이. 상세 페이지의 큰 사진이 이 폭을 넘게 표시되지 않습니다. */
export const MAX_EDGE_PX = 1600;

/** JPEG 품질. 0.82는 눈으로 차이를 못 느끼면서 용량이 크게 줄어드는 지점입니다. */
const QUALITY = 0.82;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export class ImageResizeError extends Error {}

export interface ResizedImage {
  blob: Blob;
  /** 저장에 쓸 확장자 — 저장 규칙이 파일명 확장자도 봅니다(18-5 ④) */
  extension: "jpg" | "webp";
  contentType: string;
  width: number;
  height: number;
}

/** WebP로 내보낼 수 있는지 한 번만 확인합니다. 안 되면 JPEG로 떨어집니다. */
let webpSupport: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpSupport != null) return webpSupport;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  return webpSupport;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageResizeError("사진을 변환하지 못했습니다"))),
      type,
      QUALITY
    );
  });
}

/**
 * 사진 한 장을 줄입니다.
 *
 * 원본이 이미 작아도 **다시 인코딩합니다.** 크기만 보고 건너뛰면 원본 형식(HEIC 등)이
 * 그대로 올라가 저장 규칙의 타입 검사에 걸립니다.
 */
export async function resizeImage(file: File): Promise<ResizedImage> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ImageResizeError(
      "JPG·PNG·WebP 형식만 올릴 수 있습니다. 휴대폰 사진이라면 형식을 바꿔 저장한 뒤 올려 주세요."
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageResizeError("사진을 읽지 못했습니다. 다른 파일로 시도해 주세요.");
  }

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageResizeError("사진을 변환하지 못했습니다");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const useWebp = canEncodeWebp();
  const contentType = useWebp ? "image/webp" : "image/jpeg";
  const blob = await canvasToBlob(canvas, contentType);

  return {
    blob,
    extension: useWebp ? "webp" : "jpg",
    contentType,
    width,
    height,
  };
}

/** 화면에 표시할 용량 문자열 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
