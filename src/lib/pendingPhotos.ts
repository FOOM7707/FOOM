/**
 * 저장 전에 고른 사진 — 「대기 중인 사진」 (스키마 18-3 · 20-3, v29).
 *
 * **왜 필요한가.** 사진이 저장될 자리 이름에 `programId`가 들어가는데(18-3) 그 번호는
 * 저장하는 순간 생깁니다. 그래서 v28까지는 「글을 다 쓰고 저장 → 다시 들어가서 사진」
 * 두 번 일해야 했고, 작성하는 사람에게는 **한 번에 못 끝내는 이유가 보이지 않습니다.**
 *
 * → **브라우저가 파일을 들고 있다가 저장할 때 한 번에 올립니다.** 화면에서는 등록
 * 중에도 사진을 고를 수 있고(미리보기까지 보입니다), 서버 규칙은 그대로입니다.
 *
 * **임시 폴더에 먼저 올리는 방법은 택하지 않았습니다.** 저장하지 않고 떠난 파일이
 * 쌓이고, 그걸 정리하는 문제가 새로 생깁니다(18-7의 알려진 공백을 키우게 됩니다).
 *
 * **크기 줄이기는 고를 때 바로 합니다** — 저장 버튼을 누른 뒤에 몰아서 하면 큰 사진
 * 다섯 장에서 기다리는 시간이 한꺼번에 몰립니다.
 *
 * **한 장을 고르면 파일 두 개가 올라갑니다** (2026-09-03, 20-6) — 상세용 큰 것과
 * 목록 카드용 작은 것입니다. 자세한 이유는 `imageResize.ts`에 있습니다.
 */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "@/lib/firebaseClient";
import { prepareImage, type ResizedImage } from "@/lib/imageResize";

export interface PendingPhoto {
  /** 저장 전에는 경로가 없으므로 이 값으로 가리킵니다 */
  id: string;
  full: ResizedImage;
  thumb: ResizedImage;
  /** 미리보기용 objectURL — 다 쓰면 `releasePendingPhoto`로 놓아줍니다 */
  previewUrl: string;
  originalSize: number;
  /** 실제로 올라가는 총 용량(큰 것 + 작은 것) */
  resizedSize: number;
}

/**
 * 소개 블록이 대기 중인 사진을 가리킬 때 쓰는 임시 경로.
 *
 * 저장할 때 실제 경로로 바꿔치기하므로 **서버에는 절대 이 값이 가지 않습니다.**
 * 혹시 새어 나가도 서버가 「프로그램 사진에 없는 사진」으로 거부합니다 — 조용히
 * 저장되는 실패가 아니라는 뜻입니다.
 */
export const PENDING_PATH_PREFIX = "pending:";

export function pendingPath(id: string): string {
  return `${PENDING_PATH_PREFIX}${id}`;
}

export function isPendingPath(path: string): boolean {
  return path.startsWith(PENDING_PATH_PREFIX);
}

/** 파일 이름은 난수로 만듭니다 — 원본 이름에는 한글·공백·개인정보가 섞입니다(18-3). */
export function makeFileId(extension: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${random}.${extension}`;
}

/**
 * 작은 사진의 파일 이름.
 *
 * 큰 것과 **짝이 보이게** 앞에 `t_`만 붙입니다 — 저장소를 눈으로 볼 때 어느 것이
 * 어느 사진의 작은 판인지 바로 알 수 있습니다. 폴더를 더 파지 않는 것이 중요합니다:
 * 저장 규칙이 `programs/{programId}/{fileId}` **한 단계만** 허용하므로(18-3),
 * `thumbs/` 같은 하위 폴더를 만들면 규칙과 서버 검사에 함께 걸립니다.
 */
export function thumbFileName(fileId: string): string {
  return `t_${fileId}`;
}

export async function makePendingPhoto(file: File): Promise<PendingPhoto> {
  const prepared = await prepareImage(file);
  return {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    full: prepared.full,
    thumb: prepared.thumb,
    previewUrl: URL.createObjectURL(prepared.thumb.blob),
    originalSize: file.size,
    resizedSize: prepared.full.blob.size + prepared.thumb.blob.size,
  };
}

/** 미리보기 주소를 놓아줍니다. 안 하면 파일이 메모리에 남습니다 */
export function releasePendingPhoto(photo: PendingPhoto): void {
  URL.revokeObjectURL(photo.previewUrl);
}

export interface UploadedPhoto {
  /** 어느 대기 사진이었는지 — 소개 블록의 임시 경로를 바꿔치기하는 데 씁니다 */
  id: string;
  path: string;
  url: string;
  thumbPath: string;
  thumbUrl: string;
}

/** 파일 하나를 올리고 주소를 받아옵니다. */
async function put(path: string, image: ResizedImage): Promise<string> {
  const storageRef = ref(firebaseStorage, path);
  await uploadBytes(storageRef, image.blob, { contentType: image.contentType });
  return getDownloadURL(storageRef);
}

/**
 * 대기 중인 사진을 Storage에 올립니다. **기록(문서 반영)은 호출한 쪽이 서버에 맡깁니다.**
 *
 * 브라우저가 문서를 직접 쓰지 못하게 하는 이유는 18-4와 같습니다 — 남의 파일 주소나
 * 외부 URL을 심을 수 있습니다.
 */
export async function uploadPendingPhotos(
  programId: string,
  photos: PendingPhoto[],
  onProgress?: (done: number, total: number) => void
): Promise<UploadedPhoto[]> {
  const uploaded: UploadedPhoto[] = [];
  for (let i = 0; i < photos.length; i += 1) {
    const photo = photos[i];
    onProgress?.(i, photos.length);
    const fileId = makeFileId(photo.full.extension);
    const path = `programs/${programId}/${fileId}`;
    const thumbPath = `programs/${programId}/${thumbFileName(fileId)}`;
    // 큰 것을 먼저 올립니다 — 작은 것만 올라간 상태로 실패하면 상세 페이지에
    // 쓸 사진이 없습니다. 반대 순서라면 목록이 원본으로 되돌아가기만 합니다.
    const url = await put(path, photo.full);
    const thumbUrl = await put(thumbPath, photo.thumb);
    uploaded.push({ id: photo.id, path, url, thumbPath, thumbUrl });
  }
  onProgress?.(photos.length, photos.length);
  return uploaded;
}
