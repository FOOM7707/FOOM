/**
 * 프로그램 소개 블록 편집 (스키마 20-1 · 20-2).
 *
 * **공급자는 사진을 고르고 글을 쓸 뿐입니다.** 배치·순서·모양은 화면이 정합니다 —
 * 상세 페이지에서 사진 장수에 따라 지그재그/가로 전체가 자동으로 갈립니다(20-2).
 *
 * 상세 소개를 「이미지 한 장」으로 받지 않는 이유는 20-1에 있습니다. 요약하면
 * ① 우리 공급자는 디자이너가 없는 개인 전문가이고 ② 글이 이미지 안에 있으면 검색이
 * 안 되고 ③ **수정 승인(바뀐 항목만 「전 → 후」)이 이미지 앞에서 무력화**됩니다.
 *
 * **글자 수 상한이 배치를 지킵니다.** 상한이 없으면 한 블록에 1,000자를 넣는 경우가
 * 생기고, 그러면 사진 옆 칸이 넘쳐 지그재그가 무너집니다.
 */

import { useRef, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { firebaseStorage } from "@/lib/firebaseClient";
import { ImageResizeError, formatBytes, resizeImage } from "@/lib/imageResize";
import {
  MAX_BLOCK_IMAGES,
  MAX_BODY_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_INTRO_BLOCKS,
  emptyIntroBlock,
  type IntroBlock,
} from "@/lib/programContent";

interface Props {
  /** 사진 경로에 필요합니다. 없으면(등록 단계) 사진 칸을 열지 않습니다 */
  programId: string | null;
  blocks: IntroBlock[];
  onChange: (next: IntroBlock[]) => void;
}

function makeFileId(extension: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${random}.${extension}`;
}

/** 사진 장수에 따라 상세 페이지에서 어떤 모양이 되는지 알려줍니다. */
function layoutHint(count: number): string {
  if (count === 0) return "글만 — 가로 전체 문단";
  if (count === 1) return "사진 1장 — 글과 좌우로 나란히";
  if (count === 2) return "사진 2장 — 글과 좌우, 사진은 위아래로";
  return "사진 3장 — 가로 전체, 사진 나란히 아래 글";
}

export default function IntroBlockEditor({ programId, blocks, onChange }: Props) {
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  function update(index: number, patch: Partial<IntroBlock>) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= blocks.length) return;
    const copy = [...blocks];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  }

  async function addImages(index: number, files: FileList | null) {
    if (!files || files.length === 0 || !programId) return;
    setError(null);

    const block = blocks[index];
    const room = MAX_BLOCK_IMAGES - block.images.length;
    const picked = Array.from(files).slice(0, room);
    if (picked.length === 0) {
      setError(`한 블록에 사진은 ${MAX_BLOCK_IMAGES}장까지입니다.`);
      return;
    }

    setBusyIndex(index);
    try {
      const added: IntroBlock["images"] = [];
      for (let i = 0; i < picked.length; i += 1) {
        setProgress(`${i + 1}/${picked.length} 사진을 줄이는 중…`);
        const resized = await resizeImage(picked[i]);
        setProgress(
          `${i + 1}/${picked.length} 올리는 중… (${formatBytes(picked[i].size)} → ${formatBytes(resized.blob.size)})`
        );
        const path = `programs/${programId}/${makeFileId(resized.extension)}`;
        const storageRef = ref(firebaseStorage, path);
        await uploadBytes(storageRef, resized.blob, { contentType: resized.contentType });
        added.push({ path, url: await getDownloadURL(storageRef) });
      }
      // 저장은 아래 「저장」 버튼을 눌러야 반영됩니다 — 사진은 이미 올라갔고,
      // 저장하지 않고 떠나면 참조되지 않는 파일로 남습니다(18-7의 알려진 공백).
      update(index, { images: [...block.images, ...added] });
    } catch (err) {
      setError(
        err instanceof ImageResizeError
          ? err.message
          : "사진을 올리지 못했습니다. 다시 시도해 주세요."
      );
    } finally {
      setBusyIndex(null);
      setProgress(null);
      const input = inputRefs.current[index];
      if (input) input.value = "";
    }
  }

  function removeImage(index: number, path: string) {
    const block = blocks[index];
    update(index, { images: block.images.filter((im) => im.path !== path) });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {blocks.length === 0 && (
        <p className="rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
          프로그램을 소개하는 글을 <strong className="font-semibold">블록으로 나눠</strong>{" "}
          넣습니다. 사진과 글만 넣으시면 <strong className="font-semibold">배치는 자동으로</strong>{" "}
          됩니다 — 사진에 글자를 넣지 않으셔도 됩니다.
        </p>
      )}

      {blocks.map((block, i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-lg border px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-primary">
              {i + 1}번째 블록
              <span className="ml-1.5 font-normal text-muted-foreground">
                {layoutHint(block.images.length)}
              </span>
            </span>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="px-1 disabled:opacity-35"
                title="위로"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === blocks.length - 1}
                onClick={() => move(i, 1)}
                className="px-1 disabled:opacity-35"
                title="아래로"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange(blocks.filter((_, j) => j !== i))}
                className="underline hover:text-destructive"
              >
                삭제
              </button>
            </div>
          </div>

          {/* 사진 */}
          {programId == null ? (
            <p className="rounded bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
              사진은 저장한 뒤에 넣을 수 있습니다. 지금은 글만 써 두셔도 됩니다.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {block.images.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {block.images.map((im) => (
                    <li key={im.path} className="relative">
                      <img
                        src={im.url}
                        alt=""
                        loading="lazy"
                        className="h-20 w-28 rounded border object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i, im.path)}
                        className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white"
                        title="이 사진 빼기"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(e) => void addImages(i, e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyIndex != null || block.images.length >= MAX_BLOCK_IMAGES}
                  onClick={() => inputRefs.current[i]?.click()}
                >
                  + 사진
                </Button>
                <span className="text-xs text-muted-foreground">
                  {busyIndex === i && progress
                    ? progress
                    : `${block.images.length}/${MAX_BLOCK_IMAGES}장`}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor={`intro-heading-${i}`} className="text-[12.5px]">
              소제목
            </Label>
            <Input
              id={`intro-heading-${i}`}
              value={block.heading}
              onChange={(e) => update(i, { heading: e.target.value })}
              maxLength={MAX_HEADING_LENGTH}
              placeholder="예: 숲 입구에서 함께 출발합니다"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`intro-body-${i}`} className="text-[12.5px]">
              설명
            </Label>
            <Textarea
              id={`intro-body-${i}`}
              value={block.body}
              onChange={(e) => update(i, { body: e.target.value })}
              maxLength={MAX_BODY_LENGTH}
              rows={3}
              placeholder="이 순서에서 무엇을 하는지 적어 주세요."
            />
            <span className="self-end text-[11.5px] text-muted-foreground">
              {block.body.length}/{MAX_BODY_LENGTH}
            </span>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocks.length >= MAX_INTRO_BLOCKS}
          onClick={() => onChange([...blocks, emptyIntroBlock()])}
        >
          + 소개 블록 추가
        </Button>
        <span className="text-xs text-muted-foreground">
          {blocks.length >= MAX_INTRO_BLOCKS
            ? `블록은 ${MAX_INTRO_BLOCKS}개까지입니다`
            : `${blocks.length}/${MAX_INTRO_BLOCKS}개 · 하나만 채워도 됩니다`}
        </span>
      </div>
    </div>
  );
}
