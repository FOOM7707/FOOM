/**
 * 프로그램 소개 블록 편집 (스키마 20-1 · 20-2 · 20-3).
 *
 * **공급자는 사진을 고르고 글을 쓸 뿐입니다.** 배치·순서·모양은 화면이 정합니다 —
 * 상세 페이지의 양식(지금은 양식 1 지그재그)이 좌우 배치를 자동으로 정합니다.
 *
 * 상세 소개를 「이미지 한 장」으로 받지 않는 이유는 20-1에 있습니다. 요약하면
 * ① 우리 공급자는 디자이너가 없는 개인 전문가이고 ② 글이 이미지 안에 있으면 검색이
 * 안 되고 ③ **수정 승인(바뀐 항목만 「전 → 후」)이 이미지 앞에서 무력화**됩니다.
 *
 * **v29에서 「올리기」가 「고르기」로 바뀌었습니다.** 전에는 블록마다 사진을 따로
 * 올렸는데, 그러면 같은 사진이 맨 위 앨범과 소개 글에 두 번 저장됩니다. 사진 목록은
 * 하나뿐이고(위쪽 「프로그램 사진」), 소개 블록은 **그 목록에서 한 장을 골라 씁니다.**
 *
 * **글자 수 상한이 배치를 지킵니다.** 상한이 없으면 한 블록에 1,000자를 넣는 경우가
 * 생기고, 그러면 사진 옆 칸이 넘쳐 지그재그가 무너집니다.
 */

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BODY_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_INTRO_BLOCKS,
  emptyIntroBlock,
  type IntroBlock,
  type IntroBlockImage,
} from "@/lib/programContent";

interface Props {
  /**
   * 고를 수 있는 사진 — 올려둔 것(수정 화면)이거나 저장 대기 중인 것(등록 화면)입니다.
   * 어느 쪽이든 **앨범과 같은 목록**이라 여기서 고르면 위 「프로그램 사진」과 같은
   * 사진을 가리킵니다(20-3).
   */
  photos: IntroBlockImage[];
  /**
   * 이 블록에서 바로 새 사진을 추가합니다 (v29).
   *
   * **글을 다 쓴 뒤에 다시 들어와 사진을 올리게 하지 않습니다.** 등록 화면에서도
   * 눌리고, 그때는 저장할 때 함께 올라갑니다. 추가된 사진을 돌려주면 **누른 블록에
   * 바로 넣습니다** — 그 블록에서 눌렀다는 것이 곧 그 블록에 쓰겠다는 뜻입니다.
   */
  onAddPhoto?: (files: FileList | null) => Promise<IntroBlockImage[]>;
  /** 사진 장수 상한에 닿았는지 — 더 추가할 수 없으면 이유를 보여줍니다 */
  atLimit?: boolean;
  busy?: boolean;
  progress?: string | null;
  blocks: IntroBlock[];
  onChange: (next: IntroBlock[]) => void;
}

/**
 * 이 블록이 상세 페이지에서 어떤 모양이 되는지 알려줍니다.
 *
 * 양식 1(지그재그)은 **블록 순서로 좌우가 갈립니다** — 첫 블록은 사진이 왼쪽,
 * 두 번째는 오른쪽. 순서를 바꾸면 배치도 함께 바뀌므로 여기서 미리 알려줍니다.
 */
function layoutHint(index: number, count: number): string {
  if (count === 0) return "글만 — 가로 전체 문단";
  return index % 2 === 0 ? "사진 왼쪽 · 글 오른쪽" : "글 왼쪽 · 사진 오른쪽";
}

export default function IntroBlockEditor({
  photos,
  onAddPhoto,
  atLimit = false,
  busy = false,
  progress,
  blocks,
  onChange,
}: Props) {
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

  /** 다른 블록이 이미 쓰고 있는 사진 — 같은 사진이 소개 글에 두 번 나오는 것을 막습니다 */
  function usedByOtherBlock(index: number, path: string): boolean {
    return blocks.some((b, i) => i !== index && b.images.some((im) => im.path === path));
  }

  /** 누르면 고르고, 고른 것을 다시 누르면 뺍니다. 블록당 한 장입니다 */
  function togglePhoto(index: number, photo: IntroBlockImage) {
    const chosen = blocks[index].images[0];
    update(index, { images: chosen?.path === photo.path ? [] : [photo] });
  }

  /** 이 블록에서 새 사진을 추가하고 **바로 이 블록에 넣습니다** */
  async function addHere(index: number, files: FileList | null) {
    if (!onAddPhoto) return;
    const added = await onAddPhoto(files);
    if (added.length > 0) update(index, { images: [added[0]] });
    const input = inputRefs.current[index];
    if (input) input.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.length === 0 && (
        <p className="rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
          프로그램을 소개하는 글을 <strong className="font-semibold">블록으로 나눠</strong>{" "}
          넣습니다. 블록마다 <strong className="font-semibold">사진 한 장과 글</strong>이 한
          칸이 되고, 좌우 배치는 자동으로 번갈아 놓입니다 — 사진에 글자를 넣지 않으셔도
          됩니다.
        </p>
      )}

      {blocks.map((block, i) => {
        const chosen = block.images[0];

        return (
          <div key={i} className="flex flex-col gap-2.5 rounded-lg border px-3.5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-primary">
                {i + 1}번째 블록
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {layoutHint(i, block.images.length)}
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

            {/* 사진 — 여기서 바로 추가하거나, 이미 있는 사진 중에서 고릅니다 */}
            {photos.length === 0 && !onAddPhoto ? (
              <p className="px-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                올려둔 사진이 없습니다. 위쪽 「프로그램 사진」에 먼저 올리면 여기서 고를 수
                있습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-muted-foreground">
                  {chosen
                    ? "고른 사진 (다시 누르면 뺍니다)"
                    : photos.length === 0
                      ? "사진을 넣으면 글과 좌우로 나란히 놓입니다"
                      : "쓸 사진을 고르거나 새로 추가하세요"}
                </span>
                <ul className="flex flex-wrap gap-2">
                  {photos.map((photo, pi) => {
                    const isChosen = chosen?.path === photo.path;
                    const taken = usedByOtherBlock(i, photo.path);
                    return (
                      <li key={photo.path}>
                        <button
                          type="button"
                          disabled={taken}
                          onClick={() => togglePhoto(i, photo)}
                          title={
                            taken
                              ? "다른 블록에서 쓰고 있습니다"
                              : isChosen
                                ? "빼기"
                                : "이 사진 쓰기"
                          }
                          className={`relative block overflow-hidden rounded-md border-2 transition ${
                            isChosen
                              ? "border-primary"
                              : "border-transparent hover:border-muted-foreground/40"
                          } ${taken ? "cursor-not-allowed opacity-30" : ""}`}
                        >
                          <img
                            src={photo.url}
                            alt=""
                            loading="lazy"
                            className="h-16 w-24 object-cover"
                          />
                          {/* 앨범에서의 순서 — 첫 장이 대표 사진입니다 */}
                          <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10.5px] font-semibold text-white">
                            {pi + 1}
                          </span>
                          {isChosen && (
                            <span className="absolute inset-x-0 bottom-0 bg-primary py-[1px] text-[10.5px] font-bold text-primary-foreground">
                              사용 중
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {/* 이 블록에서 바로 새 사진 추가 (v29).
                      등록 화면에서도 눌립니다 — 저장할 때 함께 올라갑니다. */}
                  {onAddPhoto && (
                    <li>
                      <input
                        ref={(el) => {
                          inputRefs.current[i] = el;
                        }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={(e) => void addHere(i, e.target.files)}
                      />
                      <button
                        type="button"
                        disabled={busy || atLimit}
                        onClick={() => inputRefs.current[i]?.click()}
                        title={
                          atLimit
                            ? "사진 장수 상한에 닿았습니다. 위쪽 「프로그램 사진」에서 빼고 추가하세요"
                            : "새 사진 올려서 이 블록에 넣기"
                        }
                        className="flex h-16 w-24 flex-col items-center justify-center rounded-md border-2 border-dashed text-[11px] leading-tight text-muted-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="text-[15px] leading-none">＋</span>
                        <span className="mt-0.5">새 사진</span>
                      </button>
                    </li>
                  )}
                </ul>
                {progress && (
                  <span className="text-[11.5px] text-muted-foreground">{progress}</span>
                )}
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
        );
      })}

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
