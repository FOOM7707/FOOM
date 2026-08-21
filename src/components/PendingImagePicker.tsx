/**
 * 등록 화면의 사진 칸 — **저장 전에 고르는 사진** (스키마 20-3, v29).
 *
 * `ProgramImageUploader`와 보이는 것은 같지만 **하는 일이 다릅니다.** 저쪽은 이미
 * 저장된 프로그램에 사진을 올리고 서버에 기록합니다(수정 화면). 이쪽은 서버를
 * 부르지 않고 **브라우저에 들고만 있다가** 저장할 때 한 번에 올립니다.
 *
 * 두 모드를 한 부품에 넣지 않은 이유: 한쪽은 모든 동작이 서버 왕복이고 다른 쪽은
 * 전부 화면 안에서 끝납니다. 섞으면 「지금 저장된 상태인가」를 매 동작마다 따져야
 * 하고, 그 판단을 한 번 틀리면 **사진이 사라지거나 두 번 올라갑니다.**
 */

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { MAX_IMAGES } from "@/components/ProgramImageUploader";
import type { PendingPhoto } from "@/lib/pendingPhotos";

interface Props {
  photos: PendingPhoto[];
  /**
   * 파일을 고름 — 크기 줄이기는 상위가 합니다(실패 안내도 한곳에 모읍니다).
   * 넣은 사진을 돌려주지만 이 칸에서는 쓰지 않습니다(소개 블록이 씁니다).
   */
  onPick: (files: FileList | null) => Promise<unknown>;
  /** 지움 — 소개 블록에서 함께 빼는 것도 상위가 합니다(서버의 연쇄 정리와 같은 규칙) */
  onRemove: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  busy: boolean;
  /** 크기를 줄이는 중 등의 진행 문구 */
  progress?: string | null;
}

export default function PendingImagePicker({
  photos,
  onPick,
  onRemove,
  onMove,
  busy,
  progress,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = MAX_IMAGES - photos.length;

  return (
    <div className="flex flex-col gap-3">
      {photos.length === 0 ? (
        <p className="px-0.5 text-[13px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold">첫 장이 목록과 검색 결과에 보이는 대표 사진</strong>
          이 됩니다. 여기 올린 사진은 <strong className="font-semibold">프로그램 소개</strong>의
          각 블록에서도 골라 쓸 수 있습니다.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {photos.map((photo, i) => (
            <li key={photo.id} className="group relative overflow-hidden rounded-lg border">
              <img
                src={photo.previewUrl}
                alt={`프로그램 사진 ${i + 1}`}
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
                    onClick={() => onMove(i, -1)}
                    title="앞으로"
                    className="rounded px-1.5 py-0.5 text-[13px] text-white disabled:opacity-35"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === photos.length - 1}
                    onClick={() => onMove(i, 1)}
                    title="뒤로"
                    className="rounded px-1.5 py-0.5 text-[13px] text-white disabled:opacity-35"
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(photo.id)}
                  className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-white disabled:opacity-35"
                >
                  빼기
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
          onChange={(e) => {
            void onPick(e.target.files);
            if (inputRef.current) inputRef.current.value = "";
          }}
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
              ? `사진은 ${MAX_IMAGES}장까지입니다`
              : `${photos.length}/${MAX_IMAGES}장 · JPG·PNG·WebP`)}
        </span>
      </div>

      {photos.length > 0 && (
        <p className="px-0.5 text-[12px] leading-relaxed text-muted-foreground">
          사진은 <strong className="font-semibold">저장할 때 함께 올라갑니다.</strong> 저장하지
          않고 나가면 올라가지 않습니다.
        </p>
      )}
    </div>
  );
}
