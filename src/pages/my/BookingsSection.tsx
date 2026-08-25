/**
 * 마이페이지 — 예약내역 (자리만).
 *
 * **목록을 만들지 않은 이유:** 예약 홀드(서버)는 만들어졌지만 결제가 없어
 * 실제로 쌓이는 예약이 없습니다. 목록을 만들면 언제나 비어 있어 고장으로
 * 읽힙니다 — 결제가 붙는 날 이 자리에 목록이 들어갑니다.
 */

export default function BookingsSection() {
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        예약·결제 기능을 준비하고 있습니다. 열리면 여기에서 신청한 프로그램과 진행 날짜,
        취소·환불 상태를 볼 수 있습니다.
      </p>

      {/* 앞으로 이 자리에 무엇이 들어오는지 미리 보여줍니다 — 빈 화면만 두면
          「기능이 없는 것」과 「아직 예약을 안 한 것」을 구분할 수 없습니다. */}
      <ul className="mt-5 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
        {[
          "신청한 프로그램과 진행 날짜",
          "결제·환불 상태",
          "취소 신청과 환불 예정 금액",
        ].map((item) => (
          <li key={item} className="flex items-center gap-2.5 rounded-lg bg-secondary px-4 py-3">
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
