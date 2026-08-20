/**
 * 프로그램 소개 블록 표시 — 지그재그 배치 (스키마 20-2).
 *
 * **배치를 저장하지 않고 사진 장수에서 계산합니다.** 공급자는 사진과 글만 넣고
 * 어떻게 놓일지는 고르지 않습니다(20-1).
 *
 * | 사진 | 배치 |
 * |---|---|
 * | 1장 | 지그재그 — 홀수 블록 사진 왼쪽 / 짝수 오른쪽 |
 * | 2장 | 지그재그 유지, 사진 칸에 위아래로 |
 * | 3장 | **가로 전체** — 반쪽 칸에 3장을 넣으면 사진이 너무 작아집니다 |
 * | 0장 | 글만, 가로 전체 문단 |
 *
 * 사진은 **지연 로딩**합니다. 상세는 아래로 긴 화면이라 대부분의 방문자가 끝까지
 * 내려가지 않습니다 — 보이는 것만 받으면 전송량이 크게 줄어듭니다(20-6).
 */

import type { IntroBlock } from "@/lib/programContent";

function BlockImages({ images, tall }: { images: IntroBlock["images"]; tall: boolean }) {
  if (images.length === 1) {
    return (
      <img
        src={images[0].url}
        alt=""
        loading="lazy"
        className={`w-full rounded-2xl object-cover ${tall ? "h-[380px]" : "h-64"}`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {images.map((im) => (
        <img
          key={im.path}
          src={im.url}
          alt=""
          loading="lazy"
          className="h-[184px] w-full rounded-2xl object-cover"
        />
      ))}
    </div>
  );
}

function BlockText({ block, index }: { block: IntroBlock; index: number }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] font-extrabold tracking-widest text-primary">
        {String(index + 1).padStart(2, "0")}
      </span>
      {block.heading && (
        <h3 className="text-[22px] font-extrabold leading-snug tracking-tight">
          {block.heading}
        </h3>
      )}
      {block.body && (
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">
          {block.body}
        </p>
      )}
    </div>
  );
}

export default function IntroBlockView({ blocks }: { blocks: IntroBlock[] }) {
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-14">
      {blocks.map((block, i) => {
        const count = block.images.length;

        // 사진 3장 — 지그재그를 풀고 가로 전체
        if (count >= 3) {
          return (
            <div key={i} className="flex flex-col gap-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {block.images.map((im) => (
                  <img
                    key={im.path}
                    src={im.url}
                    alt=""
                    loading="lazy"
                    className="h-56 w-full rounded-2xl object-cover"
                  />
                ))}
              </div>
              <BlockText block={block} index={i} />
            </div>
          );
        }

        // 사진 없음 — 글만, 가로 전체
        if (count === 0) {
          return (
            <div key={i} className="max-w-3xl">
              <BlockText block={block} index={i} />
            </div>
          );
        }

        // 1~2장 — 지그재그. 홀수 블록은 사진이 왼쪽입니다.
        const imageFirst = i % 2 === 0;
        return (
          <div key={i} className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <div className={imageFirst ? "" : "lg:order-2"}>
              <BlockImages images={block.images} tall={count === 1} />
            </div>
            <div className={imageFirst ? "" : "lg:order-1"}>
              <BlockText block={block} index={i} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
