/**
 * 프로그램 대표 사진 업로드 (스키마 18-3 · 18-4 · 20-3).
 *
 * **업로드는 브라우저가 Storage로 직접 하고, 기록은 서버가 합니다(18-4).**
 * 파일을 서버로 프록시하면 본문 크기·실행 시간 제한에 걸립니다. 대신 브라우저가
 * `imageUrls`를 직접 쓰지는 못하게 하고(남의 파일·외부 URL 삽입 차단),
 * 올린 뒤 `POST /programs/{id}/images`로 알려 서버가 검증하고 기록합니다.
 *
 * **경로에 `programId`가 필요하므로 프로그램을 먼저 저장해야 합니다(18-3).**
 * 그래서 등록 화면에서는 사진 칸을 열지 않고, 저장 후 수정 화면에서 올립니다.
 *
 * **올리기 전에 브라우저에서 크기를 줄입니다**(`imageResize.ts`) — 원본을 그대로
 * 두면 전송 비용이 10배 이상 뜁니다(20-6).
 */

import { useRef, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Button } from "@/components/ui/button";
import { firebaseStorage } from "@/lib/firebaseClient";
import { ApiError, apiFetch } from "@/lib/api";
import { ImageResizeError, formatBytes, resizeImage } from "@/lib/imageResize";

/** 대표 사진 상한 — 서버(`MAX_PROGRAM_IMAGES`)와 같은 값이어야 합니다. */
export const MAX_IMAGES = 5;

interface Props {
  programId: string;
  /** 서버가 돌려준 현재 목록 */
  imageUrls: string[];
  imagePaths: string[];
  /** 목록이 바뀌면 상위가 다시 불러옵니다 */
  onChanged: () => void | Promise<void>;
}

/** 파일 이름은 난수로 만듭니다 — 원본 이름에는 한글·공백·개인정보가 섞입니다(18-3). */
function makeFileId(extension: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${random}.${extension}`;
}

export default function ProgramImageUploader({
  programId,
  imageUrls,
  imagePaths,
  onChanged,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_IMAGES - imageUrls.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const picked = Array.from(files);
    if (picked.length > remaining) {
      setError(`${remaining}장까지 더 올릴 수 있습니다.`);
      return;
    }

    setBusy(true);
    try {
      const uploaded: Array<{ path: string; url: string }> = [];

      for (let i = 0; i < picked.length; i += 1) {
        const file = picked[i];
        setProgress(`${i + 1}/${picked.length} 사진을 줄이는 중…`);
        const resized = await resizeImage(file);

        setProgress(
          `${i + 1}/${picked.length} 올리는 중… (${formatBytes(file.size)} → ${formatBytes(resized.blob.size)})`
        );
        const path = `programs/${programId}/${makeFileId(resized.extension)}`;
        const storageRef = ref(firebaseStorage, path);
        await uploadBytes(storageRef, resized.blob, { contentType: resized.contentType });
        const url = await getDownloadURL(storageRef);
        uploaded.push({ path, url });
      }

      // 기록은 서버가 합니다. 여기서 실패하면 파일만 남는데, 문서가 참조하지
      // 않으므로 화면에는 나타나지 않습니다(미참조 파일 정리는 18-7).
      setProgress("저장하는 중…");
      await apiFetch(`/programs/${programId}/images`, {
        method: "POST",
        requireAuth: true,
        body: { images: uploaded },
      });
      await onChanged();
    } catch (err) {
      if (err instanceof ImageResizeError) setError(err.message);
      else if (err instanceof ApiError) setError(err.message);
      else setError("사진을 올리지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(path: string) {
    if (!window.confirm("이 사진을 지울까요?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/programs/${programId}/images`, {
        method: "DELETE",
        requireAuth: true,
        body: { path },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "사진을 지우지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  /** 순서 바꾸기 — 첫 장이 대표 사진입니다(2-3). */
  async function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= imagePaths.length) return;
    const paths = [...imagePaths];
    [paths[index], paths[next]] = [paths[next], paths[index]];

    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/programs/${programId}/images`, {
        method: "PATCH",
        requireAuth: true,
        body: { paths },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "순서를 바꾸지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {imageUrls.length === 0 ? (
        <p className="rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
          아직 사진이 없습니다. <strong className="font-semibold">첫 장이 목록과 검색 결과에
          보이는 대표 사진</strong>이 됩니다.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {imageUrls.map((url, i) => (
            <li key={imagePaths[i] ?? url} className="group relative overflow-hidden rounded-lg border">
              <img
                src={url}
                alt={`프로그램 사진 ${i + 1}`}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              {i === 0 && (
                <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                  대표
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1">
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    onClick={() => void move(i, -1)}
                    title="앞으로"
                    className="rounded px-1.5 py-0.5 text-[13px] text-white disabled:opacity-35"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === imageUrls.length - 1}
                    onClick={() => void move(i, 1)}
                    title="뒤로"
                    className="rounded px-1.5 py-0.5 text-[13px] text-white disabled:opacity-35"
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(imagePaths[i])}
                  className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-white disabled:opacity-35"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || remaining <= 0}
          onClick={() => inputRef.current?.click()}
        >
          + 사진 추가
        </Button>
        <span className="text-xs text-muted-foreground">
          {progress ??
            (remaining <= 0
              ? `사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다`
              : `${imageUrls.length}/${MAX_IMAGES}장 · JPG·PNG·WebP`)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        올릴 때 <strong className="font-semibold">자동으로 크기를 줄입니다</strong> — 휴대폰
        사진을 그대로 올리셔도 됩니다. 사진에 글자를 넣지 않으셔도 됩니다.
      </p>
    </div>
  );
}
