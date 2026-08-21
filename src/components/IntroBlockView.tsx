/**
 * 프로그램 소개 블록 표시 — 상세 페이지 (스키마 20-2).
 *
 * **배치를 저장하지 않습니다.** 공급자는 사진 한 장과 글만 넣고, 어떻게 놓일지는
 * 프로그램에 지정된 **양식**이 정합니다(20-1).
 *
 * ## 양식 (v29 신규)
 *
 * | 값 | 이름 | 배치 |
 * |---|---|---|
 * | `zigzag` | 양식 1 | 사진 한 장과 글이 좌우로 번갈아 — 매거진형 |
 *
 * 양식이 하나뿐인데도 갈라지는 자리를 둔 이유: 양식 2·3을 더할 때 **이 파일만
 * 고치면 되게** 하려는 것입니다. 아래 `LAYOUTS`에 한 줄을 등록하면 끝나고, 상세
 * 페이지와 등록 화면은 손대지 않습니다.
 *
 * ## 왜 이 크기인가
 *
 * 상세 페이지는 폭 1440px이고 **소개 글이 결제를 설득하는 자리**입니다(20-1).
 * 전문가 안내 화면(`/provider/apply`)의 지그재그와 같은 계열로 맞췄고, 다만 제목은
 * 그쪽보다 작습니다 — **그 화면의 문구는 우리가 쓰지만 여기 글은 공급자가 씁니다.**
 * 소제목 30자를 51px로 그리면 세 줄로 흘러 사진과 높이가 맞지 않습니다.
 *
 * 사진은 **지연 로딩**합니다. 상세는 아래로 긴 화면이라 대부분의 방문자가 끝까지
 * 내려가지 않습니다 — 보이는 것만 받으면 전송량이 크게 줄어듭니다(20-6).
 */

import type { IntroBlock, IntroLayout } from "@/lib/programContent";

interface LayoutProps {
  blocks: IntroBlock[];
}

/**
 * 글 부분 — 번호 / 소제목 / 설명 세 단.
 *
 * 번호 옆에 라벨 단어(「01. 자유」 같은)를 넣지 않습니다. 그 단어는 공급자가 따로
 * 써줘야 하는 값인데, 개인 전문가에게 채울 칸을 하나 더 늘리는 대신 번호만 둡니다.
 *
 * `break-keep`은 한국어 단어가 줄 끝에서 쪼개지는 것을 막습니다. 줄바꿈 위치를
 * 공급자가 직접 지정하게 하지는 않습니다 — 글에 태그를 넣게 하면 화면에 무엇이든
 * 심을 수 있게 됩니다.
 */
function BlockText({ block, index }: { block: IntroBlock; index: number }) {
  return (
    <div>
      <span className="text-[15px] font-extrabold tracking-widest text-primary">
        {String(index + 1).padStart(2, "0")}
      </span>
      {block.heading && (
        <h3 className="mt-3.5 break-keep text-[26px] font-extrabold leading-[1.3] tracking-tight sm:text-[34px]">
          {block.heading}
        </h3>
      )}
      {block.body && (
        <p className="mt-5 whitespace-pre-line break-keep text-[16px] leading-[1.7] text-muted-foreground sm:text-[17px]">
          {block.body}
        </p>
      )}
    </div>
  );
}

/**
 * 양식 1 — 지그재그.
 *
 * 홀수 블록은 사진이 왼쪽, 짝수 블록은 오른쪽입니다. **사진 비율도 번갈아** 갑니다
 * (가로로 넓은 4:3 ↔ 세로로 긴 4:5) — 같은 비율이 반복되면 좌우만 바뀌는 같은
 * 화면으로 읽힙니다.
 *
 * 모바일에서는 한 줄로 세우고 **항상 사진 → 글 순서**입니다. 짝수 블록의 좌우
 * 교체는 `lg:order-*`로만 하고 문서 순서는 건드리지 않았습니다 — 순서를 뒤집으면
 * 좁은 화면에서 글이 먼저 나와 무슨 사진인지 모르는 채로 읽게 됩니다.
 */
function ZigzagLayout({ blocks }: LayoutProps) {
  return (
    <div className="flex flex-col gap-20 lg:gap-[140px]">
      {blocks.map((block, i) => {
        // 블록당 한 장입니다(v29). 옛 데이터에 여러 장이 남아 있어도 첫 장만 씁니다.
        const image = block.images[0];
        const imageFirst = i % 2 === 0;

        // 사진이 없으면 글만, 가로 전체 문단입니다. 사진을 지운 블록도 여기로 옵니다
        // — 글은 남겨두기 때문입니다(사진 삭제의 연쇄 정리 참고).
        if (!image) {
          return (
            <div key={i} className="max-w-3xl">
              <BlockText block={block} index={i} />
            </div>
          );
        }

        return (
          <div
            key={i}
            className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-[72px]"
          >
            <div className={imageFirst ? "" : "lg:order-2"}>
              <img
                src={image.url}
                alt=""
                loading="lazy"
                className={`w-full rounded-[32px] object-cover shadow-[0_20px_40px_rgba(0,0,0,0.06)] ${
                  imageFirst ? "aspect-[4/3]" : "aspect-[4/5]"
                }`}
              />
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

/** 양식 등록표. 양식을 더할 때 여기에 한 줄을 넣습니다. */
const LAYOUTS: Record<IntroLayout, (props: LayoutProps) => React.ReactElement> = {
  zigzag: ZigzagLayout,
};

export default function IntroBlockView({
  blocks,
  layout,
}: {
  blocks: IntroBlock[];
  /** 프로그램에 저장된 양식. 값이 없는 옛 문서는 양식 1로 그립니다 */
  layout?: string;
}) {
  if (blocks.length === 0) return null;

  const Layout = LAYOUTS[(layout ?? "zigzag") as IntroLayout] ?? ZigzagLayout;
  return <Layout blocks={blocks} />;
}
