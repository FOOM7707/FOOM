/**
 * 목록 카드에 쓸 사진 고르기 (스키마 20-6, 2026-09-03).
 *
 * **목록은 우리 화면에서 가장 비싼 자리입니다.** 카드가 한 화면에 스무 장씩 뜨는데
 * 그전까지는 상세 페이지에 쓰는 큰 사진(긴 변 1600px)을 그대로 내려받았습니다.
 * 카드가 화면에서 260~280px로 보이는 자리라, 실제로 필요한 것의 여섯 배가 넘는
 * 데이터를 매번 받아온 셈입니다 — **그 사실은 화면 어디에도 안 나타나고 요금
 * 청구서에만 나타납니다.**
 *
 * 그래서 사진을 올릴 때 **작은 판을 함께 만들어 저장**하고(`imageResize.ts`),
 * 목록·지도·심사 화면은 이 함수로 그 작은 판을 고릅니다.
 *
 * **없으면 큰 사진으로 되돌아갑니다.** 2026-09-03 이전에 올린 사진에는 작은 판이
 * 없습니다 — 그때 빈 값을 그대로 쓰면 **이미 올라간 프로그램의 사진이 통째로
 * 사라집니다.** 되돌아가면 비용만 예전과 같을 뿐 화면은 멀쩡합니다.
 *
 * 짝을 자리(index)로 맞추는 것이 중요합니다. 서버가 두 목록의 길이를 항상 같게
 * 맞춰 저장하므로(`programImages.ts`), 여기서는 같은 번호를 그대로 봅니다.
 */

interface WithImages {
  imageUrls?: string[] | null;
  thumbUrls?: string[] | null;
}

/**
 * `index`번째 사진의 목록용 주소. 사진이 없으면 `null`입니다.
 *
 * 반환이 `null`이면 **회색 빈 칸을 두지 말고** 카테고리 이름 같은 글자를 채우세요 —
 * 빈 칸은 「깨진 화면」으로 읽힙니다.
 */
export function cardImageUrl(program: WithImages, index = 0): string | null {
  const thumb = program.thumbUrls?.[index];
  if (thumb) return thumb;
  return program.imageUrls?.[index] || null;
}
