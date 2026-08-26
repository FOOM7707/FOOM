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

import { useRef, useState } from "react";
import { GripVertical, ImagePlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
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

  /**
   * 끌어서 순서 바꾸기.
   *
   * **↑/↓ 버튼을 없애지 않습니다.** 끌기는 휴대폰에서 동작하지 않고 키보드로도 쓸 수
   * 없어서, 버튼이 유일한 대안입니다. 끌기는 넓은 화면에서 더 빠른 길일 뿐입니다.
   *
   * 카드 안에 입력칸이 있어서 카드 전체를 항상 끌 수 있게 두면 **글을 선택하려고
   * 문지르는 순간 블록이 끌려갑니다.** 손잡이를 누른 동안에만 끌기가 켜집니다.
   */
  const [armed, setArmed] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function endDrag() {
    setArmed(false);
    setDragFrom(null);
    setDragOver(null);
  }

  /** 끌어 놓은 자리로 옮깁니다 — 서로 맞바꾸는 게 아니라 그 자리에 끼워 넣습니다 */
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= blocks.length) return;
    const copy = [...blocks];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChange(copy);
  }

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
          <div
            key={i}
            draggable={armed}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) reorder(dragFrom, i);
              endDrag();
            }}
            onDragEnd={endDrag}
            className={cn(
              "flex flex-col gap-3 rounded-xl border bg-muted/40 px-4 py-3.5 transition-colors",
              dragFrom === i && "opacity-50",
              dragOver === i && dragFrom !== i && "border-primary bg-secondary/60"
            )}
          >
            <div className="flex items-center justify-between border-b pb-2.5">
              <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-primary">
                {/* 손잡이를 누른 동안에만 끌기가 켜집니다 — 그렇지 않으면 글을 선택하려고
                    문지를 때 블록이 끌려갑니다. */}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="끌어서 순서 바꾸기"
                  title="끌어서 순서 바꾸기 (또는 오른쪽 화살표 버튼)"
                  onMouseDown={() => setArmed(true)}
                  onTouchStart={() => setArmed(true)}
                  onMouseUp={() => setArmed(false)}
                  className="-ml-1 cursor-grab text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </span>
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

            {/* 참고 시안과 같은 「사진 왼쪽 · 글 오른쪽」 배치입니다. 좁은 화면에서는
                사진이 위로 올라갑니다. */}
            <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
              {/* ── 사진 ─────────────────────────────────────────────── */}
              <div className="flex flex-col gap-2">
                <input
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => void addHere(i, e.target.files)}
                />

                {chosen ? (
                  <button
                    type="button"
                    onClick={() => togglePhoto(i, chosen)}
                    title="빼기"
                    className="group relative block aspect-[4/3] overflow-hidden rounded-lg border-2 border-primary"
                  >
                    <img src={chosen.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-[11.5px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                      빼기
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || atLimit || !onAddPhoto}
                    onClick={() => inputRefs.current[i]?.click()}
                    title={
                      atLimit
                        ? "사진 장수 상한에 닿았습니다"
                        : "새 사진 올려서 이 블록에 넣기"
                    }
                    className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-input bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-secondary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-input disabled:hover:bg-card"
                  >
                    <ImagePlus className="mb-1 h-6 w-6" strokeWidth={1.5} aria-hidden />
                    <span className="text-[12.5px] font-bold">사진 등록</span>
                  </button>
                )}

                {/* 이미 올린 사진에서 고르기 — 대표 사진처럼 이미 있는 것을 쓸 때입니다 */}
                {photos.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
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
                              taken ? "다른 블록에서 쓰고 있습니다" : isChosen ? "빼기" : "이 사진 쓰기"
                            }
                            className={`relative block overflow-hidden rounded border-2 transition ${
                              isChosen ? "border-primary" : "border-transparent hover:border-muted-foreground/40"
                            } ${taken ? "cursor-not-allowed opacity-30" : ""}`}
                          >
                            <img src={photo.url} alt="" loading="lazy" className="h-9 w-12 object-cover" />
                            <span className="absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">
                              {pi + 1}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {progress && <span className="text-[12px] text-muted-foreground">{progress}</span>}
              </div>

              {/* ── 글 ──────────────────────────────────────────────── */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`intro-heading-${i}`} className="text-[13px]">
                    소제목
                  </Label>
                  <Input
                    id={`intro-heading-${i}`}
                    value={block.heading}
                    onChange={(e) => update(i, { heading: e.target.value })}
                    maxLength={MAX_HEADING_LENGTH}
                    placeholder="예: 숲 입구에서 함께 출발합니다"
                  />
                  <span className="self-end text-[12px] text-muted-foreground">
                    {block.heading.length}/{MAX_HEADING_LENGTH}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`intro-body-${i}`} className="text-[13px]">
                    설명
                  </Label>
                  <Textarea
                    id={`intro-body-${i}`}
                    value={block.body}
                    onChange={(e) => update(i, { body: e.target.value })}
                    maxLength={MAX_BODY_LENGTH}
                    rows={4}
                    placeholder="이 순서에서 무엇을 하는지 적어 주세요."
                  />
                  <span className="self-end text-[12px] text-muted-foreground">
                    {block.body.length}/{MAX_BODY_LENGTH}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={blocks.length >= MAX_INTRO_BLOCKS}
          onClick={() => onChange([...blocks, emptyIntroBlock()])}
          className="flex items-center gap-2 rounded-xl border border-dashed border-primary px-6 py-3 text-sm font-bold text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent"
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          소개 블록 추가
        </button>
        <span className="text-xs text-muted-foreground">
          {blocks.length >= MAX_INTRO_BLOCKS
            ? `블록은 ${MAX_INTRO_BLOCKS}개까지입니다`
            : `${blocks.length}/${MAX_INTRO_BLOCKS}개 · 하나만 채워도 됩니다`}
        </span>
      </div>
    </div>
  );
}
